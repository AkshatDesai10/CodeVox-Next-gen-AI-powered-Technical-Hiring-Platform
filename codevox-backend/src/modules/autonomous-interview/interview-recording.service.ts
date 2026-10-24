import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AutonomousInterviewRepository } from './autonomous-interview.repository';
import {
  AutonomousInterviewRoundsRepository,
  resolveRoundType,
} from './autonomous-interview-rounds.repository';
import {
  AutonomousInterviewRoundType,
} from './entities/autonomous-interview-round.mysql.entity';
import { LiveKitService } from './livekit.service';
import {
  InterviewRecordingMysql,
  type InterviewRecordingStatus,
} from './entities/interview-recording.mysql.entity';
import {
  detectRecordingKind,
  detectRecordingPhase,
  isBuildVideoRecordingEnabled,
  kindFromStorageKey,
  recordingDisplayLabel,
  resolveLocalRecordingRelativePath,
  interviewRecordingPrefix,
  toRecordingPlaybackUrl,
  toRecordingStorageUrl,
  type RecordingKind,
  type RecordingPhase,
} from './recording-playback';

const TRACK_SYNC_MIN_INTERVAL_MS = 10_000;

export type InterviewRecordingView = {
  id: string;
  candidateToken: string;
  engine: string | null;
  stageId: string | null;
  status: InterviewRecordingStatus;
  startedAt: string;
  endedAt: string | null;
  playbackUrl: string | null;
  phase: RecordingPhase;
  kind: RecordingKind;
  label: string;
  mediaType: 'audio' | 'video';
};

@Injectable()
export class InterviewRecordingService {
  private readonly logger = new Logger(InterviewRecordingService.name);
  private readonly lastTrackSync = new Map<string, number>();

  constructor(
    @InjectRepository(InterviewRecordingMysql)
    private readonly recordings: Repository<InterviewRecordingMysql>,
    private readonly interviews: AutonomousInterviewRepository,
    private readonly rounds: AutonomousInterviewRoundsRepository,
    private readonly livekit: LiveKitService,
  ) {}

  /**
   * Start a new egress for this session unless one is still running. Egresses that ended on
   * their own (room emptied on leave) are closed out first, so a rejoin gets a new recording.
   */
  async start(
    candidateToken: string,
    roomName: string,
    meta: {
      engine?: string | null;
      stageId?: string | null;
      portalToken?: string | null;
      roundType?: AutonomousInterviewRoundType | string | null;
    },
  ): Promise<InterviewRecordingMysql | null> {
    const open = await this.recordings.find({
      where: { candidateToken, status: 'recording' },
      order: { startedAt: 'DESC' },
    });
    for (const rec of open) {
      const lifecycle = await this.livekit.getEgressStatus(rec.egressId);
      if (lifecycle === 'active' || lifecycle === 'unknown') {
        return rec;
      }
      const endedAt = new Date();
      await this.recordings.update(
        { id: rec.id },
        { status: lifecycle === 'failed' ? 'failed' : 'completed', endedAt },
      );
    }

    const started = await this.livekit.startRoomCompositeEgress(roomName, candidateToken, {
      prefix: interviewRecordingPrefix(),
    });
    if (!started) return null;

    const roundType =
      (Object.values(AutonomousInterviewRoundType).find((v) => v === meta.roundType) as
        | AutonomousInterviewRoundType
        | undefined) ??
      (Object.values(AutonomousInterviewRoundType).find((v) => v === meta.stageId) as
        | AutonomousInterviewRoundType
        | undefined) ??
      resolveRoundType({
        engine: meta.engine,
        stageType: meta.stageId,
      });

    const now = new Date();
    const saved = await this.recordings.save(
      this.recordings.create({
        candidateToken,
        portalToken: meta.portalToken ?? null,
        stageId: roundType,
        engine: meta.engine ?? null,
        egressId: started.egressId,
        storageKey: started.storageKey,
        recordingUrl: started.recordingUrl,
        status: 'recording',
        startedAt: now,
        endedAt: null,
      }),
    );

    await this.rounds.patchRound(candidateToken, roundType, {
      livekitRoomName: roomName,
      livekitEgressId: started.egressId,
      recordingStartedAt: now,
    });
    return saved;
  }

  /** Stop every running egress for the session and close out its rows. */
  async stopActive(candidateToken: string, legacyEgressId?: string | null): Promise<void> {
    const open = await this.recordings.find({ where: { candidateToken, status: 'recording' } });
    const egressIds = new Set(open.map((r) => r.egressId));

    for (const rec of open) {
      const stopped = await this.livekit.stopEgress(rec.egressId);
      let status: InterviewRecordingStatus = 'completed';
      if (!stopped) {
        const lifecycle = await this.livekit.getEgressStatus(rec.egressId);
        status = lifecycle === 'ended' ? 'completed' : 'failed';
      }
      await this.recordings.update({ id: rec.id }, { status, endedAt: new Date() });
    }

    // Sessions whose egress started before this table existed.
    if (legacyEgressId && !egressIds.has(legacyEgressId)) {
      const tracked = await this.recordings.count({ where: { egressId: legacyEgressId } });
      if (!tracked) await this.livekit.stopEgress(legacyEgressId);
    }
  }

  /**
   * Mirror the voice engine's per-track egresses (agent audio, candidate audio, screen share)
   * into interview_recordings, one row per egress. Rows are finalised once LiveKit reports the
   * uploaded file, so this is re-run on read and shortly after the session ends.
   */
  async syncTrackEgresses(candidateToken: string, opts: { force?: boolean } = {}): Promise<void> {
    const now = Date.now();
    const last = this.lastTrackSync.get(candidateToken) ?? 0;
    if (!opts.force && now - last < TRACK_SYNC_MIN_INTERVAL_MS) return;
    this.lastTrackSync.set(candidateToken, now);

    const row = await this.interviews.findByTokenForAdmin(candidateToken);
    if (!row) return;
    const meta = (row.proctorSummary as Record<string, unknown> | null) ?? {};
    const roundType = resolveRoundType({
      currentPhase: row.currentPhase,
      stageType: typeof meta.stageType === 'string' ? meta.stageType : null,
    });
    const round = await this.rounds.findByTokenAndType(candidateToken, roundType);
    const roomName = this.livekit.resolveRoomName(
      candidateToken,
      round?.livekitRoomName ?? row.livekitRoomName,
    );
    const egresses = await this.livekit.listRoomTrackEgresses(roomName);
    if (!egresses?.length) return;

    const portalToken = typeof meta.portalToken === 'string' ? meta.portalToken : null;
    const stageId = roundType;
    const existing = new Map(
      (
        await this.recordings.find({
          where: { egressId: In(egresses.map((e) => e.egressId)) },
        })
      ).map((r) => [r.egressId, r]),
    );

    for (const eg of egresses) {
      const status: InterviewRecordingStatus =
        eg.lifecycle === 'active' ? 'recording' : eg.lifecycle === 'failed' ? 'failed' : 'completed';
      const localRel = resolveLocalRecordingRelativePath(eg.storageKey);
      // Always local — track egress writes under /out (local-recordings mount).
      const recordingUrl = localRel
        ? toRecordingStorageUrl({ key: localRel })
        : eg.storageKey.startsWith('local-recordings/')
          ? eg.storageKey
          : toRecordingStorageUrl({ key: eg.storageKey });
      const current = existing.get(eg.egressId);

      if (!current) {
        const kind = kindFromStorageKey(eg.storageKey);
        // Build camera video is env-gated — never persist user_video when disabled.
        if (kind === 'user_video' && !isBuildVideoRecordingEnabled()) {
          continue;
        }
        try {
          await this.recordings.save(
            this.recordings.create({
              candidateToken,
              portalToken,
              stageId,
              engine: kind || null,
              egressId: eg.egressId,
              storageKey: eg.storageKey,
              recordingUrl,
              status,
              startedAt: eg.startedAt ?? new Date(),
              endedAt: eg.endedAt,
            }),
          );
        } catch (err) {
          if ((err as { code?: string })?.code !== 'ER_DUP_ENTRY') throw err;
        }
      } else if (current.status !== status || current.storageKey !== eg.storageKey) {
        await this.recordings.update(
          { id: current.id },
          {
            status,
            storageKey: eg.storageKey,
            recordingUrl,
            stageId: current.stageId ?? stageId,
            endedAt: eg.endedAt ?? current.endedAt,
          },
        );
      }
    }
  }

  private async syncQuietly(candidateToken: string) {
    try {
      await this.syncTrackEgresses(candidateToken);
    } catch (err) {
      this.logger.warn(
        `Track recording sync failed token=${candidateToken}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listForToken(candidateToken: string): Promise<InterviewRecordingView[]> {
    await this.syncQuietly(candidateToken);
    const rows = await this.recordings.find({
      where: { candidateToken },
      order: { startedAt: 'ASC' },
    });
    return this.toViews(rows, [candidateToken]);
  }

  async listForPortal(portalToken: string): Promise<InterviewRecordingView[]> {
    const sessions = await this.interviews.findAllForPortalToken(portalToken).catch(() => []);
    for (const s of sessions) await this.syncQuietly(s.candidateToken);
    const rows = await this.recordings.find({
      where: { portalToken },
      order: { startedAt: 'ASC' },
    });
    return this.toViews(rows, [
      ...sessions.map((s) => s.candidateToken),
      ...rows.map((r) => r.candidateToken),
    ]);
  }

  /** Prefer portal-scoped list (Build+Defend); fall back to the single session token. */
  async listForApplication(candidateOrPortalToken: string): Promise<InterviewRecordingView[]> {
    const byPortal = await this.listForPortal(candidateOrPortalToken).catch(() => []);
    if (byPortal.length) return byPortal;

    const own = await this.listForToken(candidateOrPortalToken);
    if (!own.length) return own;

    const portalFromRow = await this.recordings.findOne({
      where: { candidateToken: candidateOrPortalToken },
      order: { startedAt: 'DESC' },
    });
    const portal = portalFromRow?.portalToken?.trim();
    if (portal && portal !== candidateOrPortalToken) {
      const linked = await this.listForPortal(portal).catch(() => []);
      if (linked.length) return linked;
    }
    return own;
  }

  private async toViews(
    rows: InterviewRecordingMysql[],
    mergedForTokens: string[] = [],
  ): Promise<InterviewRecordingView[]> {
    const allowBuildVideo = isBuildVideoRecordingEnabled();
    const views = await Promise.all(
      this.uniqueByFile(rows).map(async (r) => {
        const source = r.storageKey || r.recordingUrl;
        const phase = detectRecordingPhase(source, r.stageId);
        const kind = detectRecordingKind(r.engine);
        return {
          id: String(r.id),
          candidateToken: r.candidateToken,
          engine: r.engine,
          stageId: r.stageId,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt?.toISOString() ?? null,
          playbackUrl: await toRecordingPlaybackUrl(r.recordingUrl || r.storageKey),
          phase,
          kind,
          label: recordingDisplayLabel(phase, kind),
          mediaType:
            kind === 'screen_share' || kind === 'user_video' || kind === 'other'
              ? ('video' as const)
              : ('audio' as const),
        };
      }),
    );
    const merged = await this.mergedViews(mergedForTokens);
    const filtered = [...views, ...merged].filter(
      (v) => v.kind !== 'user_video' || (allowBuildVideo && v.phase === 'build'),
    );
    return this.dedupeForDisplay(filtered);
  }

  /**
   * The merge job re-saves each track file as a raw_ row (bucket rewritten, no extension),
   * so several rows can point at one file. Keep the best row per file.
   */
  private uniqueByFile(rows: InterviewRecordingMysql[]): InterviewRecordingMysql[] {
    const rank = (r: InterviewRecordingMysql) =>
      (r.egressId?.startsWith('raw_') ? 0 : 4) +
      (r.status === 'completed' ? 2 : 0) +
      (r.recordingUrl || r.storageKey ? 1 : 0);
    const best = new Map<string, InterviewRecordingMysql>();
    for (const r of rows) {
      const src = (r.storageKey || r.recordingUrl || '').split('?')[0];
      const at = src.indexOf('interview-recordings/');
      const path = (at >= 0 ? src.slice(at) : src.replace(/^https?:\/\/[^/]+\//, ''))
        .replace(/\.[a-z0-9]{2,5}$/i, '');
      const key = path || `id:${r.id}`;
      const prev = best.get(key);
      if (!prev || rank(r) > rank(prev)) best.set(key, r);
    }
    return [...best.values()];
  }

  /**
   * Every part per (phase, kind) in time order: a reconnect starts new track egresses, so
   * one round can have several candidate-audio / screen-share parts. Failed parts are
   * hidden when a playable completed part exists for the same (phase, kind).
   */
  private dedupeForDisplay(views: InterviewRecordingView[]): InterviewRecordingView[] {
    const groups = new Map<string, InterviewRecordingView[]>();
    for (const view of views) {
      if (view.kind === 'screen_share_audio') continue; // hide until A/V merge exists
      const key = `${view.phase}:${view.kind}`;
      const list = groups.get(key) ?? [];
      list.push(view);
      groups.set(key, list);
    }
    for (const [key, list] of groups) {
      const hasPlayable = list.some((v) => v.status === 'completed' && v.playbackUrl);
      const parts = list
        .filter((v) => !hasPlayable || (v.status !== 'failed' && v.playbackUrl))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      if (parts.length > 1) {
        parts.forEach((v, i) => {
          v.label = `${v.label} (part ${i + 1} of ${parts.length})`;
        });
      }
      groups.set(key, parts);
    }
    const order = [
      'screening:agent_audio',
      'screening:user_audio',
      'screening:screen_share',
      'screening:merged',
      'build:agent_audio',
      'build:user_audio',
      'build:user_video',
      'build:screen_share',
      'build:merged',
      'defend:agent_audio',
      'defend:user_audio',
      'defend:screen_share',
      'defend:merged',
      'verbal:agent_audio',
      'verbal:user_audio',
      'verbal:screen_share',
      'verbal:merged',
    ];
    const ordered: InterviewRecordingView[] = [];
    for (const key of order) {
      ordered.push(...(groups.get(key) ?? []));
      groups.delete(key);
    }
    for (const parts of groups.values()) ordered.push(...parts);
    return ordered;
  }

  /** One entry per round whose per-track files were merged (autonomous_interview_rounds.merged_recording_url). */
  private async mergedViews(candidateTokens: string[]): Promise<InterviewRecordingView[]> {
    let rounds: Awaited<ReturnType<AutonomousInterviewRoundsRepository['findWithMergedRecording']>> = [];
    try {
      rounds = await this.rounds.findWithMergedRecording(candidateTokens);
    } catch (err) {
      this.logger.warn(
        `Merged recording lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    return Promise.all(
      rounds.map(async (r) => {
        const url = (r.mergedRecordingUrl ?? '').trim();
        const phase = detectRecordingPhase(null, r.roundType);
        return {
          id: `merged_${r.id}`,
          candidateToken: r.candidateToken,
          engine: 'merged',
          stageId: r.roundType,
          status: 'completed' as const,
          startedAt: (r.recordingStartedAt ?? r.createdAt).toISOString(),
          endedAt: r.updatedAt?.toISOString() ?? null,
          playbackUrl: await toRecordingPlaybackUrl(url),
          phase,
          kind: 'merged' as const,
          label: recordingDisplayLabel(phase, 'merged'),
          mediaType: /\.(m4a|mp3|ogg|wav)(\?|$)/i.test(url)
            ? ('audio' as const)
            : ('video' as const),
        };
      }),
    );
  }

  async saveRawTrack(
    candidateToken: string,
    kind: string,
    url: string,
    stageId?: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.recordings.save(
      this.recordings.create({
        candidateToken,
        portalToken: null,
        stageId: stageId ?? null,
        engine: kind,
        egressId: `raw_${kind}_${Date.now()}`,
        storageKey: url,
        recordingUrl: url,
        status: 'completed',
        startedAt: now,
        endedAt: now,
      }),
    );
  }
}
