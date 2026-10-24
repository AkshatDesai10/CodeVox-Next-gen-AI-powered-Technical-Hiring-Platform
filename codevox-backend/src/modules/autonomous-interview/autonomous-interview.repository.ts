import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import {
  AutonomousInterviewPhase,
  CandidateAutonomousInterviewMysql,
} from './entities/candidate-autonomous-interview.mysql.entity';
import {
  AutonomousInterviewRoundStatus,
  AutonomousInterviewRoundType,
} from './entities/autonomous-interview-round.mysql.entity';
import {
  AutonomousInterviewRoundsRepository,
  resolveRoundType,
} from './autonomous-interview-rounds.repository';

type RoundAwarePatch = QueryDeepPartialEntity<CandidateAutonomousInterviewMysql> & {
  stage1VoiceAudit?: object | null;
  hrVoiceAudit?: object | null;
  screeningVoiceAudit?: object | null;
  recordingUrl?: string | null;
  livekitEgressId?: string | null;
  recordingStartedAt?: Date | null;
};

const ROUND_PATCH_KEYS = [
  'stage1VoiceAudit',
  'hrVoiceAudit',
  'screeningVoiceAudit',
  'recordingUrl',
  'livekitEgressId',
  'recordingStartedAt',
] as const;

@Injectable()
export class AutonomousInterviewRepository {
  constructor(
    @InjectRepository(CandidateAutonomousInterviewMysql)
    private readonly repo: Repository<CandidateAutonomousInterviewMysql>,
    private readonly rounds: AutonomousInterviewRoundsRepository,
  ) {}

  private async hydrateOne(
    row: CandidateAutonomousInterviewMysql | null,
  ): Promise<CandidateAutonomousInterviewMysql | null> {
    if (!row) return null;
    const rounds = await this.rounds.findByToken(row.candidateToken);
    const byType = new Map(rounds.map((r) => [r.roundType, r]));

    const screening = byType.get(AutonomousInterviewRoundType.AI_SCREENING);
    const hr = byType.get(AutonomousInterviewRoundType.HR_VERBAL);
    const intro = byType.get(AutonomousInterviewRoundType.INTRO_VERBAL);
    const bnd = byType.get(AutonomousInterviewRoundType.BND_INTERVIEW);

    row.screeningVoiceAudit = (screening?.chatTranscript as object | null) ?? null;
    row.hrVoiceAudit = (hr?.chatTranscript as object | null) ?? null;
    row.stage1VoiceAudit =
      ((intro?.chatTranscript ?? bnd?.chatTranscript) as object | null) ?? null;

    row.recordingUrl = this.rounds.latestMergedUrl(rounds);

    const active =
      rounds.find((r) => r.status === AutonomousInterviewRoundStatus.IN_PROGRESS) ??
      rounds[rounds.length - 1] ??
      null;
    row.livekitEgressId = active?.livekitEgressId ?? null;
    row.recordingStartedAt = active?.recordingStartedAt ?? null;
    return row;
  }

  private async hydrateMany(rows: CandidateAutonomousInterviewMysql[]) {
    return Promise.all(rows.map((r) => this.hydrateOne(r) as Promise<CandidateAutonomousInterviewMysql>));
  }

  async findByToken(candidateToken: string) {
    const row = await this.repo.findOne({
      where: { candidateToken, inactive: 0 },
    });
    return this.hydrateOne(row);
  }

  /** Admin report lookup — include inactive sessions so completed/archived rounds still open. */
  async findByTokenForAdmin(candidateToken: string) {
    const row = await this.repo.findOne({
      where: { candidateToken },
    });
    return this.hydrateOne(row);
  }

  async findForApplication(portalToken: string) {
    // Prefer real LiveKit sessions linked via proctorSummary.portalToken.
    // Demo create also seeds a shell row with candidateToken === portalToken; that
    // shell must not shadow the completed ses_ screening/verbal session.
    const linked = await this.repo
      .createQueryBuilder('cai')
      .where('cai.inactive = 0')
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(cai.proctor_summary, '$.portalToken')) = :token",
        { token: portalToken },
      )
      .orderBy('cai.created_at', 'DESC')
      .getMany();
    if (linked.length) {
      // The demo shell uses candidateToken === portalToken and stays on intro_verbal.
      // It must not hide a finished ses_ session, or the portal keeps the round live.
      const sessions = linked.filter((r) => r.candidateToken !== portalToken);
      const pool = sessions.length ? sessions : linked;
      // Newest session wins (created_at DESC). An older abandoned intro_verbal
      // must not keep the round "live" after a later attempt completed.
      return this.hydrateOne(pool[0]);
    }

    const direct = await this.findByToken(portalToken);
    return direct;
  }

  async findForApplicationAndStage(portalToken: string, stageId: string, stageType?: string) {
    const linked = await this.repo
      .createQueryBuilder('cai')
      .where('cai.inactive = 0')
      .andWhere(
        "JSON_UNQUOTE(JSON_EXTRACT(cai.proctor_summary, '$.portalToken')) = :token",
        { token: portalToken },
      )
      .andWhere(
        "(JSON_UNQUOTE(JSON_EXTRACT(cai.proctor_summary, '$.stageId')) = :stageId OR (:stageType IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(cai.proctor_summary, '$.stageType')) = :stageType))",
        { stageId: String(stageId), stageType: stageType || null },
      )
      .orderBy('cai.created_at', 'DESC')
      .getMany();

    if (linked.length) {
      // Newest session wins — do not prefer older non-completed rows.
      return this.hydrateOne(linked[0]);
    }
    return null;
  }

  /** All LiveKit/AI sessions linked to an application portal token (includes inactive). */
  async findAllForPortalToken(portalToken: string) {
    const rows = await this.repo
      .createQueryBuilder('cai')
      .where(
        "JSON_UNQUOTE(JSON_EXTRACT(cai.proctor_summary, '$.portalToken')) = :token",
        { token: portalToken },
      )
      .orWhere('cai.candidateToken = :token', { token: portalToken })
      .orderBy('cai.created_at', 'DESC')
      .getMany();
    return this.hydrateMany(rows);
  }

  async requireByToken(candidateToken: string) {
    const row = await this.findByToken(candidateToken);
    if (!row) {
      throw new NotFoundException('Interview session not found');
    }
    return row;
  }

  async updatePhase(candidateToken: string, phase: AutonomousInterviewPhase) {
    await this.repo.update({ candidateToken }, { currentPhase: phase });
    return this.requireByToken(candidateToken);
  }

  async saveRoom(candidateToken: string, livekitRoomName: string) {
    await this.repo.update({ candidateToken }, { livekitRoomName });
  }

  private async applyRoundPatch(candidateToken: string, patch: RoundAwarePatch) {
    const existing = await this.repo.findOne({ where: { candidateToken } });
    const existingMeta = (existing?.proctorSummary as Record<string, unknown> | null) ?? {};
    const patchMeta = (patch.proctorSummary as Record<string, unknown> | undefined) ?? undefined;
    const stageType =
      (patchMeta && typeof patchMeta.stageType === 'string' ? patchMeta.stageType : undefined) ||
      (typeof existingMeta.stageType === 'string' ? existingMeta.stageType : undefined);

    if (patch.screeningVoiceAudit !== undefined) {
      await this.rounds.setChatTranscript(
        candidateToken,
        AutonomousInterviewRoundType.AI_SCREENING,
        (patch.screeningVoiceAudit as object | null) ?? null,
        {
          status:
            patch.screeningVoiceAudit != null
              ? AutonomousInterviewRoundStatus.COMPLETED
              : AutonomousInterviewRoundStatus.IN_PROGRESS,
        },
      );
    }
    if (patch.hrVoiceAudit !== undefined) {
      await this.rounds.setChatTranscript(
        candidateToken,
        AutonomousInterviewRoundType.HR_VERBAL,
        (patch.hrVoiceAudit as object | null) ?? null,
        {
          status:
            patch.hrVoiceAudit != null
              ? AutonomousInterviewRoundStatus.COMPLETED
              : AutonomousInterviewRoundStatus.IN_PROGRESS,
        },
      );
    }
    if (patch.stage1VoiceAudit !== undefined) {
      const roundType = resolveRoundType({
        stageType,
        voicePhase: 'intro_verbal',
        currentPhase: existing?.currentPhase,
      });
      // On /complete the phase is already "completed", so resolveRoundType falls back to intro_verbal.
      const target =
        roundType === AutonomousInterviewRoundType.BND_INTERVIEW || stageType === 'project_interview'
          ? AutonomousInterviewRoundType.BND_INTERVIEW
          : AutonomousInterviewRoundType.INTRO_VERBAL;
      await this.rounds.setChatTranscript(
        candidateToken,
        target,
        (patch.stage1VoiceAudit as object | null) ?? null,
        {
          status:
            patch.stage1VoiceAudit != null
              ? AutonomousInterviewRoundStatus.COMPLETED
              : AutonomousInterviewRoundStatus.IN_PROGRESS,
          aiScore:
            typeof patch.stage1VoiceScore === 'number' ? patch.stage1VoiceScore : undefined,
        },
      );
    }

    const recordingTouch =
      patch.recordingUrl !== undefined ||
      patch.livekitEgressId !== undefined ||
      patch.recordingStartedAt !== undefined;
    if (recordingTouch) {
      const roundType = resolveRoundType({
        currentPhase: existing?.currentPhase,
        stageType,
      });
      await this.rounds.patchRound(candidateToken, roundType, {
        ...(patch.recordingUrl !== undefined
          ? { mergedRecordingUrl: patch.recordingUrl as string | null }
          : {}),
        ...(patch.livekitEgressId !== undefined
          ? { livekitEgressId: patch.livekitEgressId as string | null }
          : {}),
        ...(patch.recordingStartedAt !== undefined
          ? { recordingStartedAt: patch.recordingStartedAt as Date | null }
          : {}),
      });
    }
  }

  async patch(candidateToken: string, patch: RoundAwarePatch) {
    const masterPatch: QueryDeepPartialEntity<CandidateAutonomousInterviewMysql> = { ...patch };
    for (const key of ROUND_PATCH_KEYS) {
      delete (masterPatch as Record<string, unknown>)[key];
    }

    if (Object.keys(masterPatch).length > 0) {
      await this.repo.update({ candidateToken }, masterPatch);
    }
    await this.applyRoundPatch(candidateToken, patch);
    return this.requireByToken(candidateToken);
  }

  createSeed(row: Partial<CandidateAutonomousInterviewMysql>) {
    return this.repo.save(this.repo.create(row));
  }

  private async hydrateTokensFromRounds(roundTypes: AutonomousInterviewRoundType[]) {
    const roundRows = await this.rounds.findWithTranscript(roundTypes);
    const out: CandidateAutonomousInterviewMysql[] = [];
    const seen = new Set<string>();
    for (const r of roundRows) {
      if (seen.has(r.candidateToken)) continue;
      seen.add(r.candidateToken);
      const row = await this.repo.findOne({
        where: { candidateToken: r.candidateToken, inactive: 0 },
      });
      const hydrated = await this.hydrateOne(row);
      if (hydrated) out.push(hydrated);
    }
    return out;
  }

  /** Rows with a persisted Stage-1 voice audit (for admin report listing without disk). */
  findWithStage1VoiceAudit() {
    return this.hydrateTokensFromRounds([
      AutonomousInterviewRoundType.INTRO_VERBAL,
      AutonomousInterviewRoundType.BND_INTERVIEW,
    ]);
  }

  /** Rows with AI Behavioural / HR voice audit. */
  findWithHrVoiceAudit() {
    return this.hydrateTokensFromRounds([AutonomousInterviewRoundType.HR_VERBAL]);
  }

  /** Rows with AI Screening voice audit. */
  findWithScreeningVoiceAudit() {
    return this.hydrateTokensFromRounds([AutonomousInterviewRoundType.AI_SCREENING]);
  }

  /**
   * Sessions whose chat lives on the interview row. A media lockout can end
   * the round before a voice audit is copied onto autonomous_interview_rounds,
   * so the report list would otherwise skip them.
   */
  findWithChatHistory() {
    return this.repo
      .createQueryBuilder('cai')
      .where('cai.inactive = 0')
      .andWhere(
        '(JSON_LENGTH(cai.stage1_chat_history) > 0 OR JSON_LENGTH(cai.stage3_chat_history) > 0)',
      )
      .orderBy('cai.updated_at', 'DESC')
      .getMany();
  }
}
