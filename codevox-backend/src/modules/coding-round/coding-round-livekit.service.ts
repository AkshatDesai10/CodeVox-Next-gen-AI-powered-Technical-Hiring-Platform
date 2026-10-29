import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AutonomousInterviewRepository } from '../autonomous-interview/autonomous-interview.repository';
import {
  AutonomousInterviewRoundsRepository,
  roomNameForRound,
} from '../autonomous-interview/autonomous-interview-rounds.repository';
import {
  AutonomousInterviewPhase,
  CandidateAutonomousInterviewMysql,
} from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import {
  AutonomousInterviewRoundStatus,
  AutonomousInterviewRoundType,
} from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { InterviewRecordingMysql } from '../autonomous-interview/entities/interview-recording.mysql.entity';
import { LiveKitService } from '../autonomous-interview/livekit.service';
import { interviewRecordingPrefix } from '../autonomous-interview/recording-playback';
import { resolveProctorStrikeConfig } from '../proctor/proctor-env.config';
import { InterviewGlobalConfigRepository } from '../proctor/interview-global-config.repository';
import { DynamicConfigService } from '../system-config/dynamic-config.service';

type ApplicationRow = {
  id: string;
  job_profile_id: string;
  candidateId: string;
  candidateToken: string;
  status: string;
};

@Injectable()
export class CodingRoundLiveKitService {
  private readonly logger = new Logger(CodingRoundLiveKitService.name);

  constructor(
    private readonly interviews: AutonomousInterviewRepository,
    private readonly rounds: AutonomousInterviewRoundsRepository,
    private readonly livekit: LiveKitService,
    private readonly interviewConfig: InterviewGlobalConfigRepository,
    private readonly dynamicConfig: DynamicConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(InterviewRecordingMysql)
    private readonly recordings: Repository<InterviewRecordingMysql>,
  ) {}

  private async resolveApplication(portalToken: string): Promise<ApplicationRow> {
    const rows = await this.dataSource.query(
      `SELECT id, job_profile_id, candidate_id AS candidateId, candidate_token AS candidateToken, status
       FROM job_applications WHERE candidate_token = ? AND inactive = 0 LIMIT 1`,
      [portalToken],
    );
    const application = rows?.[0] as ApplicationRow | undefined;
    if (!application) throw new NotFoundException('Invalid or expired candidate token');
    return application;
  }

  private async resolveCodingStage(jobProfileId: string) {
    const stages = await this.dataSource.query(
      `SELECT id, stage_key, stage_type, name, sort_order
       FROM job_profile_stages
       WHERE job_profile_id = ? AND inactive = 0
       ORDER BY sort_order ASC`,
      [jobProfileId],
    );
    const coding = (stages as Array<{ id: string; stage_type: string; name: string }>).find(
      (s) =>
        s.stage_type === 'coding' ||
        /coding/i.test(s.name || '') ||
        s.stage_type === 'coding_assessment',
    );
    if (!coding) throw new NotFoundException('Coding stage not found for this application');
    return coding;
  }

  /** Find or create the LiveKit ses_ session for this portal coding attempt. */
  async ensureSession(portalToken: string) {
    const application = await this.resolveApplication(portalToken);
    const stage = await this.resolveCodingStage(String(application.job_profile_id));

    const existing = await this.interviews.findForApplicationAndStage(
      portalToken,
      String(stage.id),
      'coding',
    );
    if (
      existing &&
      existing.candidateToken.startsWith('ses_') &&
      existing.currentPhase !== AutonomousInterviewPhase.COMPLETED
    ) {
      return { session: existing, application, stage, created: false };
    }

    const candidateRows = await this.dataSource.query(
      `SELECT first_name, last_name, skills FROM candidates WHERE id = ? LIMIT 1`,
      [application.candidateId],
    );
    const cand = candidateRows?.[0] as
      | { first_name?: string; last_name?: string; skills?: string[] }
      | undefined;
    const profileRows = await this.dataSource.query(
      `SELECT title, required_skills FROM job_profiles WHERE id = ? LIMIT 1`,
      [application.job_profile_id],
    );
    const profile = profileRows?.[0] as
      | { title?: string; required_skills?: string[] }
      | undefined;

    const sessionToken = `ses_${randomBytes(16).toString('hex')}`;
    await this.interviews.createSeed({
      candidateToken: sessionToken,
      jobProfileId: String(application.job_profile_id),
      isPreview: 0,
      currentPhase: AutonomousInterviewPhase.SANDBOX_CODE,
      techStack: profile?.required_skills?.[0] ?? profile?.title ?? 'General',
      resumeSkills: cand?.skills ?? profile?.required_skills ?? [],
      proctorSummary: {
        portalToken: application.candidateToken,
        stageId: String(stage.id),
        stageType: 'coding',
      },
    } as Partial<CandidateAutonomousInterviewMysql>);

    const session = await this.interviews.requireByToken(sessionToken);
    return { session, application, stage, created: true };
  }

  async initLiveKit(portalToken: string) {
    const { session, application } = await this.ensureSession(portalToken);
    const candidateToken = session.candidateToken;
    const roomName = roomNameForRound(candidateToken, AutonomousInterviewRoundType.CODING);

    await this.rounds.ensureRound(candidateToken, AutonomousInterviewRoundType.CODING, {
      livekitRoomName: roomName,
    });
    await this.interviews.saveRoom(candidateToken, roomName);

    void this.livekit.ensureRoomMetadata(roomName, {
      session_type: 'candidate_interview',
      candidate_token: candidateToken,
      portal_token: portalToken,
      round_type: AutonomousInterviewRoundType.CODING,
      stage_type: 'coding',
    });

    const { token: livekitToken, url: livekitUrl } =
      await this.livekit.createParticipantToken({
        roomName,
        identity: `candidate-${candidateToken}`,
        name: 'Candidate',
      });

    const global = await this.interviewConfig.getConfig();
    const strikeCfg = resolveProctorStrikeConfig((key, fallback = '') =>
      this.dynamicConfig.getSync(key, fallback),
    );

    return {
      portalToken,
      sessionToken: candidateToken,
      applicationId: String(application.id),
      roomName,
      livekitToken,
      livekitUrl,
      currentPhase: session.currentPhase,
      roundType: AutonomousInterviewRoundType.CODING,
      proctorConfig: {
        faceCheckIntervalMs: global.proctorFaceCheckIntervalMs,
        faceMatchThreshold: global.proctorFaceMatchThreshold,
        requireCameraForStart: false,
        requireVoiceEnroll: false,
        requireScreenShare: true,
        graceSeconds: strikeCfg.graceSeconds,
        enableMediaStrikes: strikeCfg.enableMediaStrikes,
        maxMediaStrikes: strikeCfg.maxMediaStrikes,
        autoSubmitOnMediaStrike: strikeCfg.autoSubmitOnMediaStrike,
        enableFocusStrikes: strikeCfg.enableFocusStrikes,
        maxFocusStrikes: strikeCfg.maxFocusStrikes,
        autoSubmitOnFocusStrike: strikeCfg.autoSubmitOnFocusStrike,
        focusStrikeThresholdSeconds: strikeCfg.focusStrikeThresholdSeconds,
      },
    };
  }

  async startTrackRecording(
    portalToken: string,
    body: { track_id: string; kind?: string },
  ) {
    const trackId = String(body.track_id ?? '').trim();
    if (!trackId) throw new BadRequestException('track_id is required');
    const kind = String(body.kind ?? 'screen_share').trim() || 'screen_share';

    const { session } = await this.ensureSession(portalToken);
    const candidateToken = session.candidateToken;
    const round = await this.rounds.findByTokenAndType(
      candidateToken,
      AutonomousInterviewRoundType.CODING,
    );
    const roomName =
      round?.livekitRoomName?.trim() ||
      session.livekitRoomName?.trim() ||
      roomNameForRound(candidateToken, AutonomousInterviewRoundType.CODING);

    // Idempotent: reuse active egress for same track or same kind (screen_share).
    const open = await this.recordings.find({
      where: { candidateToken, status: 'recording' },
      order: { startedAt: 'DESC' },
    });
    for (const rec of open) {
      if (rec.engine === kind || rec.egressId.includes(trackId)) {
        const lifecycle = await this.livekit.getEgressStatus(rec.egressId);
        if (lifecycle === 'active' || lifecycle === 'unknown') {
          return {
            recording: true,
            egressId: rec.egressId,
            kind,
            reused: true,
          };
        }
        await this.recordings.update(
          { id: rec.id },
          {
            status: lifecycle === 'failed' ? 'failed' : 'completed',
            endedAt: new Date(),
          },
        );
      }
    }

    const ts = Date.now();
    const folder = `${interviewRecordingPrefix()}/${candidateToken}_coding`;
    const filepath = `${folder}/${ts}_${kind}`;
    const started = await this.livekit.startTrackEgress({
      roomName,
      trackId,
      filepath,
    });
    if (!started) {
      return { recording: false, reason: 'egress_unavailable' };
    }

    const meta = (session.proctorSummary as Record<string, unknown> | null) ?? {};
    const portal =
      typeof meta.portalToken === 'string' ? meta.portalToken : portalToken;

    await this.recordings.save(
      this.recordings.create({
        candidateToken,
        portalToken: portal,
        stageId: AutonomousInterviewRoundType.CODING,
        engine: kind,
        egressId: started.egressId,
        storageKey: started.storageKey,
        recordingUrl: started.recordingUrl,
        status: 'recording',
        startedAt: new Date(),
        endedAt: null,
      }),
    );

    await this.rounds.patchRound(candidateToken, AutonomousInterviewRoundType.CODING, {
      livekitEgressId: started.egressId,
      recordingStartedAt: new Date(),
      status: AutonomousInterviewRoundStatus.IN_PROGRESS,
    });

    this.logger.log(
      `Coding track egress started token=${candidateToken} kind=${kind} egress=${started.egressId}`,
    );

    return {
      recording: true,
      egressId: started.egressId,
      kind,
      reused: false,
    };
  }

  async stopRecording(portalToken: string) {
    const { session } = await this.ensureSession(portalToken);
    const candidateToken = session.candidateToken;
    const open = await this.recordings.find({
      where: { candidateToken, status: 'recording' },
    });
    const endedAt = new Date();
    for (const rec of open) {
      await this.livekit.stopEgress(rec.egressId);
      await this.recordings.update(
        { id: rec.id },
        { status: 'completed', endedAt },
      );
    }
    await this.rounds.patchRound(candidateToken, AutonomousInterviewRoundType.CODING, {
      status: AutonomousInterviewRoundStatus.COMPLETED,
    });
    if (session.currentPhase !== AutonomousInterviewPhase.COMPLETED) {
      await this.interviews.patch(candidateToken, {
        currentPhase: AutonomousInterviewPhase.COMPLETED,
      });
    }
    const roomName =
      session.livekitRoomName?.trim() ||
      roomNameForRound(candidateToken, AutonomousInterviewRoundType.CODING);
    void this.livekit.deleteRoom(roomName);
    return { stopped: open.length };
  }
}
