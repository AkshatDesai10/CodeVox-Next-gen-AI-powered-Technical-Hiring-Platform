import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  AutonomousInterviewDecision,
  AutonomousInterviewPhase,
  CandidateAutonomousInterviewMysql,
} from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRoundType } from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { AutonomousInterviewRoundsRepository } from '../autonomous-interview/autonomous-interview-rounds.repository';
import { CodingRoundSubmissionEntity } from '../coding-round/coding-round-submission.entity';
import { JobApplicationMysql } from '../job-profiles/entities/job-application.mysql.entity';
import {
  JobProfileStageMysql,
  JobStageType,
} from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { TakeHomeSubmissionMysql } from '../take-home/entities/take-home-submission.mysql.entity';
import { ProjectInterviewService } from '../project-interview/project-interview.service';
import {
  ProjectInterviewStatus,
  ProjectInterviewSubmissionMysql,
} from '../project-interview/entities/project-interview-submission.mysql.entity';
import { ApplicationRoundSnapshotMysql } from './entities/application-round-snapshot.mysql.entity';

export const ROUND_SOURCE = {
  CODING: 'coding_round_submissions',
  TAKE_HOME: 'take_home_submissions',
  INTERVIEW: 'candidate_autonomous_interviews',
  /** Stages frozen onto the application at assign/apply time (pending until attempted). */
  ASSIGNED: 'assigned_pipeline',
} as const;

export type UpsertRoundSnapshotInput = {
  jobApplicationId: string;
  stageId?: string | null;
  stageKey?: string | null;
  stageType: string;
  stageName: string;
  sortOrder?: number;
  sourceTable: string;
  sourceId: string;
  scorePct?: number | null;
  status?: string | null;
  attemptedAt?: Date | null;
};

@Injectable()
export class RoundSnapshotService {
  private readonly logger = new Logger(RoundSnapshotService.name);

  constructor(
    @InjectRepository(ApplicationRoundSnapshotMysql)
    private readonly snapshots: Repository<ApplicationRoundSnapshotMysql>,
    @InjectRepository(JobProfileStageMysql)
    private readonly stages: Repository<JobProfileStageMysql>,
    @InjectRepository(CodingRoundSubmissionEntity)
    private readonly codingSubs: Repository<CodingRoundSubmissionEntity>,
    @InjectRepository(TakeHomeSubmissionMysql)
    private readonly takeHomeSubs: Repository<TakeHomeSubmissionMysql>,
    @InjectRepository(CandidateAutonomousInterviewMysql)
    private readonly interviews: Repository<CandidateAutonomousInterviewMysql>,
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    private readonly interviewRounds: AutonomousInterviewRoundsRepository,
    private readonly projectInterview: ProjectInterviewService,
  ) {}

  private async hydrateInterview(
    row: CandidateAutonomousInterviewMysql | null,
  ): Promise<CandidateAutonomousInterviewMysql | null> {
    if (!row) return null;
    const rounds = await this.interviewRounds.findByToken(row.candidateToken);
    const byType = new Map(rounds.map((r) => [r.roundType, r]));
    const screening = byType.get(AutonomousInterviewRoundType.AI_SCREENING);
    const hr = byType.get(AutonomousInterviewRoundType.HR_VERBAL);
    const intro = byType.get(AutonomousInterviewRoundType.INTRO_VERBAL);
    const bnd = byType.get(AutonomousInterviewRoundType.BND_INTERVIEW);
    row.screeningVoiceAudit = (screening?.chatTranscript as object | null) ?? null;
    row.hrVoiceAudit = (hr?.chatTranscript as object | null) ?? null;
    row.stage1VoiceAudit =
      ((intro?.chatTranscript ?? bnd?.chatTranscript) as object | null) ?? null;
    row.recordingUrl = this.interviewRounds.latestMergedUrl(rounds);
    return row;
  }

  private async hydrateInterviews(rows: CandidateAutonomousInterviewMysql[]) {
    return Promise.all(
      rows.map(async (r) => (await this.hydrateInterview(r)) as CandidateAutonomousInterviewMysql),
    );
  }

  async listForApplication(
    jobApplicationId: string,
  ): Promise<ApplicationRoundSnapshotMysql[]> {
    return this.snapshots.find({
      where: { jobApplicationId: String(jobApplicationId), inactive: 0 },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  async listForApplications(
    applicationIds: string[],
  ): Promise<Map<string, ApplicationRoundSnapshotMysql[]>> {
    if (!applicationIds.length) return new Map();
    const rows = await this.snapshots.find({
      where: { jobApplicationId: In(applicationIds.map(String)), inactive: 0 },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const map = new Map<string, ApplicationRoundSnapshotMysql[]>();
    for (const row of rows) {
      const list = map.get(row.jobApplicationId) ?? [];
      list.push(row);
      map.set(row.jobApplicationId, list);
    }
    return map;
  }

  /**
   * Insert or update score/status. stage_name / stage_type are frozen on first write.
   */
  async upsert(input: UpsertRoundSnapshotInput): Promise<ApplicationRoundSnapshotMysql> {
    const existing = await this.snapshots.findOne({
      where: {
        jobApplicationId: String(input.jobApplicationId),
        sourceTable: input.sourceTable,
        sourceId: String(input.sourceId),
      },
    });

    if (existing) {
      existing.inactive = 0;
      if (input.scorePct !== undefined) existing.scorePct = input.scorePct;
      if (input.status !== undefined) existing.status = input.status;
      if (input.attemptedAt !== undefined) {
        existing.attemptedAt = input.attemptedAt;
      }
      return this.snapshots.save(existing);
    }

    const row = this.snapshots.create({
      jobApplicationId: String(input.jobApplicationId),
      stageId: input.stageId != null ? String(input.stageId) : null,
      stageKey: input.stageKey ?? null,
      stageType: input.stageType,
      stageName: input.stageName.trim() || input.stageType,
      sortOrder: input.sortOrder ?? 0,
      sourceTable: input.sourceTable,
      sourceId: String(input.sourceId),
      scorePct: input.scorePct ?? null,
      status: input.status ?? null,
      attemptedAt: input.attemptedAt ?? null,
      inactive: 0,
    });
    const saved = await this.snapshots.save(row);
    this.logger.log(
      `Frozen round snapshot app=${input.jobApplicationId} name="${saved.stageName}" type=${saved.stageType}`,
    );
    return saved;
  }

  async upsertFromCoding(submission: CodingRoundSubmissionEntity): Promise<void> {
    try {
      const app = await this.applications.findOne({
        where: { id: String(submission.applicationId), inactive: 0 },
      });
      if (!app) return;

      // Prefer assigned coding stage for this app when stageKey matches.
      const assignedRows = await this.snapshots.find({
        where: {
          jobApplicationId: String(app.id),
          sourceTable: ROUND_SOURCE.ASSIGNED,
          inactive: 0,
        },
      });
      const assignedMatch = assignedRows.find(
        (s) =>
          s.stageKey === submission.stageKey ||
          (s.stageType === JobStageType.CODING &&
            assignedRows.filter((x) => x.stageType === JobStageType.CODING).length === 1),
      );

      const stage =
        (assignedMatch?.stageId
          ? await this.stages.findOne({ where: { id: String(assignedMatch.stageId) } })
          : null) ??
        (await this.findStageForCoding(String(app.jobProfileId), submission.stageKey));

      await this.upsert({
        jobApplicationId: String(submission.applicationId),
        stageId: stage ? String(stage.id) : assignedMatch?.stageId ?? null,
        stageKey: submission.stageKey,
        stageType: assignedMatch?.stageType ?? stage?.stageType ?? JobStageType.CODING,
        stageName:
          assignedMatch?.stageName?.trim() ||
          stage?.name?.trim() ||
          'Coding',
        sortOrder: assignedMatch?.sortOrder ?? stage?.sortOrder ?? 0,
        sourceTable: ROUND_SOURCE.CODING,
        sourceId: String(submission.id),
        scorePct: submission.scorePct != null ? Number(submission.scorePct) : null,
        status: submission.status,
        attemptedAt: submission.submittedAt ?? submission.createdAt ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `upsertFromCoding failed for ${submission.id}: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  async upsertFromTakeHome(submission: TakeHomeSubmissionMysql): Promise<void> {
    try {
      const stage = await this.stages.findOne({
        where: { id: String(submission.stageId) },
      });

      const assignedMeta = await this.snapshots.findOne({
        where: {
          jobApplicationId: String(submission.jobApplicationId),
          sourceTable: ROUND_SOURCE.ASSIGNED,
          sourceId: String(submission.stageId),
          inactive: 0,
        },
      });

      // Prefer assigned freeze; else live take-home name; else historical take-home label.
      let stageName = assignedMeta?.stageName?.trim() || 'Take-home';
      let sortOrder = assignedMeta?.sortOrder ?? stage?.sortOrder ?? 0;
      if (!assignedMeta?.stageName?.trim()) {
        if (stage?.stageType === JobStageType.TAKE_HOME && stage.name?.trim()) {
          stageName = stage.name.trim();
        } else if (stage?.jobProfileId) {
          const hist = await this.stages.find({
            where: {
              jobProfileId: String(stage.jobProfileId),
              stageType: JobStageType.TAKE_HOME,
            },
            order: { sortOrder: 'ASC' },
          });
          const soft = hist.filter((s) => Number(s.inactive) !== 0);
          const pick = soft.length ? soft[soft.length - 1] : hist[0];
          if (pick?.name?.trim()) stageName = pick.name.trim();
        }
      }

      await this.upsert({
        jobApplicationId: String(submission.jobApplicationId),
        stageId: String(submission.stageId),
        stageKey: assignedMeta?.stageKey ?? stage?.stageKey ?? null,
        stageType: JobStageType.TAKE_HOME,
        stageName,
        sortOrder,
        sourceTable: ROUND_SOURCE.TAKE_HOME,
        sourceId: String(submission.id),
        scorePct: submission.score != null ? Number(submission.score) : null,
        status: submission.status,
        attemptedAt: submission.submittedAt ?? submission.createdAt ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `upsertFromTakeHome failed for ${submission.id}: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  async upsertFromProjectSubmission(
    app: JobApplicationMysql,
    submission: ProjectInterviewSubmissionMysql,
  ): Promise<void> {
    try {
      const stage = await this.stages.findOne({
        where: { id: String(submission.stageId) },
      });
      const summary = await this.projectInterview.getReportSummary(
        String(app.id),
        String(submission.stageId),
      );
      let status: string = 'pending';
      const scorePct =
        summary?.final_combined_score_pct != null
          ? Number(summary.final_combined_score_pct)
          : null;

      switch (submission.status) {
        case ProjectInterviewStatus.COMPLETED:
          status = 'completed';
          break;
        case ProjectInterviewStatus.EVALUATING_CODE:
          status = 'evaluating';
          break;
        case ProjectInterviewStatus.IN_BUILD:
          status = 'in_progress';
          break;
        case ProjectInterviewStatus.READY_FOR_INTERVIEW: {
          let defendCompleted = false;
          if (submission.interviewToken) {
            const defendInt = await this.interviews.findOne({
              where: { candidateToken: submission.interviewToken },
            });
            if (defendInt?.currentPhase === AutonomousInterviewPhase.COMPLETED) {
              defendCompleted = true;
            }
          }
          status = defendCompleted ? 'completed' : 'in_progress';
          break;
        }
        case ProjectInterviewStatus.PENDING_SUBMISSION:
          status = submission.selectedProjectId ? 'in_progress' : 'pending';
          break;
        case ProjectInterviewStatus.EXPIRED:
          status = 'failed';
          break;
      }

      const assignedMeta = await this.snapshots.findOne({
        where: {
          jobApplicationId: String(app.id),
          stageId: String(submission.stageId),
          sourceTable: ROUND_SOURCE.ASSIGNED,
          inactive: 0,
        },
      });

      await this.upsert({
        jobApplicationId: String(app.id),
        stageId: String(submission.stageId),
        stageKey: stage?.stageKey ?? assignedMeta?.stageKey ?? null,
        stageType: JobStageType.PROJECT_INTERVIEW,
        stageName:
          assignedMeta?.stageName?.trim() ||
          stage?.name?.trim() ||
          'Build & Defend',
        sortOrder: assignedMeta?.sortOrder ?? stage?.sortOrder ?? 0,
        sourceTable: ROUND_SOURCE.INTERVIEW,
        sourceId:
          submission.interviewToken ||
          submission.buildSessionToken ||
          submission.submissionToken,
        scorePct,
        status,
        attemptedAt:
          submission.submittedAt ??
          submission.selectedAt ??
          submission.createdAt ??
          null,
      });
    } catch (e) {
      this.logger.warn(
        `upsertFromProjectSubmission failed for ${submission.id}: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  async upsertFromInterview(
    app: JobApplicationMysql,
    interview: CandidateAutonomousInterviewMysql,
  ): Promise<void> {
    try {
      if (!this.interviewHasAttempt(interview)) return;

      const stages = await this.stages.find({
        where: { jobProfileId: String(app.jobProfileId) },
        order: { sortOrder: 'ASC' },
      });

      // Prefer the verbal stage frozen on this application (not a later live replacement).
      const assignedRows = await this.snapshots.find({
        where: {
          jobApplicationId: String(app.id),
          sourceTable: ROUND_SOURCE.ASSIGNED,
          inactive: 0,
        },
      });
      const assignedVerbalIds = new Set(
        assignedRows
          .filter((s) =>
            [
              JobStageType.SCREENING,
              JobStageType.AI_SCREENING,
              JobStageType.AI_VERBAL,
              JobStageType.HR_VERBAL,
              JobStageType.PROJECT_INTERVIEW,
            ].includes(s.stageType as JobStageType),
          )
          .map((s) => String(s.stageId ?? ''))
          .filter(Boolean),
      );
      const assignedVerbal = stages.filter((s) => assignedVerbalIds.has(String(s.id)));
      const stage =
        (assignedVerbal.length
          ? this.pickVerbalStage(assignedVerbal, app, interview)
          : undefined) ?? this.pickVerbalStage(stages, app, interview);

      // Prefer frozen assigned name when we hit an assigned stage.
      const assignedMeta = assignedRows.find(
        (s) => s.stageId && String(s.stageId) === String(stage?.id ?? ''),
      );

      const stageType =
        assignedMeta?.stageType ?? stage?.stageType ?? JobStageType.AI_VERBAL;
      const screeningAudit =
        interview.screeningVoiceAudit && typeof interview.screeningVoiceAudit === 'object'
          ? (interview.screeningVoiceAudit as Record<string, unknown>)
          : null;
      const analyzerStatus = String(screeningAudit?.analyzerStatus ?? '');
      const proctor = (interview.proctorSummary as Record<string, unknown> | null) ?? {};
      // Leaving Build marks that session COMPLETED before Defend starts.
      const isBuildSession = proctor.bndPhase === 'build';

      let scorePct: number | null = null;
      // Round status = attempt lifecycle. Do NOT store finalDecision (UNDER_REVIEW /
      // AUTO_PASS…) here — that is application-level HR review, not "round in review".
      let status: string | null =
        interview.currentPhase === AutonomousInterviewPhase.COMPLETED && !isBuildSession
          ? interview.finalDecision === AutonomousInterviewDecision.AUTO_REJECT
            ? 'failed'
            : 'completed'
          : 'in_progress';
      if (stageType === JobStageType.AI_SCREENING || screeningAudit) {
        // AI Screening is soft-flag only — never invent a competency score.
        scorePct = null;
        if (analyzerStatus === 'COMPLETED') status = 'completed';
        else if (analyzerStatus === 'FAILED') status = 'failed';
        else if (screeningAudit) status = 'evaluating';
      } else if (interview.hrVoiceAudit && typeof interview.hrVoiceAudit === 'object') {
        const hr = interview.hrVoiceAudit as Record<string, unknown>;
        const weighted = Number(hr.weighted_competency_score);
        scorePct = Number.isFinite(weighted) ? Math.round(weighted * 20 * 10) / 10 : null;
        status = String(hr.platform_decision ?? status ?? 'completed');
      } else if (interview.stage1VoiceAudit && typeof interview.stage1VoiceAudit === 'object') {
        const audit = interview.stage1VoiceAudit as Record<string, unknown>;
        const th = audit.take_home_verification as Record<string, unknown> | undefined;
        const combined = Number(th?.final_combined_score_pct ?? audit.final_combined_score_pct);
        const weighted10 = Number(audit.weighted_overall_10);
        const depth = Number(audit.depth_score ?? audit.depth_score_secondary);
        const scorecard = Array.isArray(audit.rubric_scorecard) ? audit.rubric_scorecard : null;
        if (Number.isFinite(combined) && combined > 0) {
          scorePct = combined;
        } else if (Number.isFinite(weighted10) && weighted10 > 0) {
          scorePct = Math.round(weighted10 * 100) / 10;
        } else if (scorecard && scorecard.length > 0) {
          const validScores = scorecard
            .map((s: Record<string, any>) => Number(s.score_10 ?? s.score))
            .filter((s) => Number.isFinite(s));
          if (validScores.length > 0) {
            const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
            scorePct = Math.round(avg * 100) / 10;
          } else if (Number.isFinite(depth) && depth > 0) {
            scorePct = Math.round(depth * 100) / 10;
          } else if (interview.stage1VoiceScore != null) {
            scorePct = Number(interview.stage1VoiceScore) * 10;
          }
        } else if (Number.isFinite(depth) && depth > 0) {
          scorePct = Math.round(depth * 100) / 10;
        } else if (interview.stage1VoiceScore != null) {
          scorePct = Number(interview.stage1VoiceScore) * 10;
        }
      } else if (interview.stage1VoiceScore != null) {
        scorePct = Number(interview.stage1VoiceScore) * 10;
      } else if (interview.codeQualityScore != null) {
        scorePct = Number(interview.codeQualityScore) * 10;
      }

      // Build & Defend: persist code+verbal final, and reflect true stage status.
      if (stageType === JobStageType.PROJECT_INTERVIEW && stage) {
        try {
          const summary = await this.projectInterview.getReportSummary(
            String(app.id),
            String(stage.id),
          );
          if (summary?.final_combined_score_pct != null) {
            scorePct = Number(summary.final_combined_score_pct);
          }
          if (summary?.status) {
            switch (summary.status) {
              case ProjectInterviewStatus.COMPLETED:
                status = 'completed';
                break;
              case ProjectInterviewStatus.EVALUATING_CODE:
                status = 'evaluating';
                break;
              case ProjectInterviewStatus.IN_BUILD:
                status = 'in_progress';
                break;
              case ProjectInterviewStatus.READY_FOR_INTERVIEW: {
                const defendToken = summary.interview_token ?? null;
                let defendCompleted = false;
                if (defendToken) {
                  if (String(interview.candidateToken) === String(defendToken)) {
                    defendCompleted =
                      interview.currentPhase === AutonomousInterviewPhase.COMPLETED;
                  } else {
                    const defendInt = await this.interviews.findOne({
                      where: { candidateToken: defendToken },
                    });
                    defendCompleted =
                      defendInt?.currentPhase === AutonomousInterviewPhase.COMPLETED;
                  }
                }
                status = defendCompleted ? 'completed' : 'in_progress';
                break;
              }
              case ProjectInterviewStatus.PENDING_SUBMISSION:
                status = summary.project_id ? 'in_progress' : 'pending';
                break;
              case ProjectInterviewStatus.EXPIRED:
                status = 'failed';
                break;
            }
          }
        } catch (err) {
          this.logger.warn(
            `project combined score for snapshot ${app.id}/${stage.id}: ${(err as Error)?.message ?? err}`,
          );
        }
      }

      await this.upsert({
        jobApplicationId: String(app.id),
        stageId: stage ? String(stage.id) : null,
        stageKey: stage?.stageKey ?? null,
        stageType,
        stageName:
          assignedMeta?.stageName?.trim() ||
          stage?.name?.trim() ||
          (stageType === JobStageType.AI_SCREENING ? 'AI Screening' : 'AI Interview'),
        sortOrder: assignedMeta?.sortOrder ?? stage?.sortOrder ?? 0,
        sourceTable: ROUND_SOURCE.INTERVIEW,
        sourceId: interview.candidateToken,
        scorePct,
        status,
        attemptedAt: interview.updatedAt ?? interview.createdAt ?? null,
      });
    } catch (e) {
      this.logger.warn(
        `upsertFromInterview failed for ${app.id}: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  /** Convenience for interview session completion hooks. */
  async upsertFromInterviewToken(sessionToken: string, portalToken?: string): Promise<void> {
    try {
      const interview = await this.hydrateInterview(
        await this.interviews.findOne({ where: { candidateToken: sessionToken } }),
      );
      if (!interview) return;
      const appToken = portalToken || sessionToken;
      const app = await this.applications.findOne({
        where: { candidateToken: appToken, inactive: 0 },
      });
      if (!app) return;
      await this.upsertFromInterview(app, interview);
    } catch (e) {
      this.logger.warn(
        `upsertFromInterviewToken failed for ${sessionToken}: ${(e as Error)?.message ?? e}`,
      );
    }
  }

  /**
   * One-time / lazy backfill from existing submissions. Freezes best-effort names;
   * existing snapshot names are never overwritten.
   */
  async ensureForApplication(jobApplicationId: string): Promise<ApplicationRoundSnapshotMysql[]> {
    const app = await this.applications.findOne({
      where: { id: String(jobApplicationId), inactive: 0 },
    });
    if (!app) return [];

    const [coding, takeHome, projectSubs, interviewRows] = await Promise.all([
      this.codingSubs.find({
        where: { applicationId: String(app.id), inactive: false },
      }),
      this.takeHomeSubs.find({
        where: { jobApplicationId: String(app.id), inactive: 0 },
      }),
      this.projectInterview.getSubmissionsForApplication(String(app.id)),
      app.candidateToken
        ? this.interviews
            .createQueryBuilder('i')
            .where('i.candidateToken = :token', { token: app.candidateToken })
            .orWhere("JSON_UNQUOTE(JSON_EXTRACT(i.proctor_summary, '$.portalToken')) = :token", {
              token: app.candidateToken,
            })
            .orderBy('i.created_at', 'ASC')
            .getMany()
            .then((rows) => this.hydrateInterviews(rows))
        : Promise.resolve([] as CandidateAutonomousInterviewMysql[]),
    ]);

    for (const row of coding) {
      await this.upsertFromCoding(row);
    }
    for (const row of takeHome) {
      await this.upsertFromTakeHome(row);
    }
    for (const row of projectSubs) {
      await this.upsertFromProjectSubmission(app, row);
    }
    // Upsert every LiveKit ses_ session so each stage snapshot keeps its own source_id.
    // Skip portal/demo seed rows (candidateToken === portal) — those are shells, not rounds.
    const portal = app.candidateToken ?? '';
    for (const interview of interviewRows) {
      const token = String(interview.candidateToken ?? '');
      if (portal && token === portal) continue;
      if (token.startsWith('demo_')) continue;
      await this.upsertFromInterview(app, interview);
    }

    return this.listForApplication(String(app.id));
  }

  async ensureForApplications(applicationIds: string[]): Promise<Map<string, ApplicationRoundSnapshotMysql[]>> {
    const map = new Map<string, ApplicationRoundSnapshotMysql[]>();
    const unique = [...new Set(applicationIds.map(String))];
    for (const appId of unique) {
      map.set(appId, await this.ensureForApplication(appId));
    }
    return map;
  }

  /**
   * Freeze the live profile stages onto this application at assign time.
   * Later profile edits must not add/remove these rows.
   * No-op if assigned rows already exist.
   */
  async freezeAssignedPipeline(jobApplicationId: string): Promise<ApplicationRoundSnapshotMysql[]> {
    const app = await this.applications.findOne({
      where: { id: String(jobApplicationId), inactive: 0 },
    });
    if (!app) return [];

    const existingAssigned = await this.snapshots.find({
      where: {
        jobApplicationId: String(app.id),
        sourceTable: ROUND_SOURCE.ASSIGNED,
        inactive: 0,
      },
    });
    if (existingAssigned.length) {
      return this.listForApplication(String(app.id));
    }

    const liveStages = await this.stages.find({
      where: { jobProfileId: String(app.jobProfileId), inactive: 0 },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    for (const stage of liveStages) {
      await this.upsert({
        jobApplicationId: String(app.id),
        stageId: String(stage.id),
        stageKey: stage.stageKey,
        stageType: stage.stageType,
        stageName: stage.name?.trim() || stage.stageType,
        sortOrder: stage.sortOrder ?? 0,
        sourceTable: ROUND_SOURCE.ASSIGNED,
        sourceId: String(stage.id),
        scorePct: null,
        status: 'pending',
        attemptedAt: null,
      });
    }

    this.logger.log(
      `Frozen assigned pipeline app=${app.id} stages=${liveStages.length}`,
    );
    return this.listForApplication(String(app.id));
  }

  /**
   * Stages assigned to this application only.
   * - If assigned_pipeline rows exist → exactly those (names from assigned / attempt overlay)
   * - Else legacy fallback → only attempted stages + currentStageId (never full profile history)
   */
  pipelineStagesForApplication(
    app: JobApplicationMysql,
    allStages: JobProfileStageMysql[],
    snapshots: ApplicationRoundSnapshotMysql[] = [],
  ): JobProfileStageMysql[] {
    const assigned = snapshots.filter(
      (s) => s.sourceTable === ROUND_SOURCE.ASSIGNED && Number(s.inactive) === 0,
    );
    const attempts = snapshots.filter(
      (s) => s.sourceTable !== ROUND_SOURCE.ASSIGNED && Number(s.inactive) === 0,
    );

    const norm = (id: string | number | null | undefined) =>
      id == null || id === '' ? '' : String(id);

    const stageIds = new Set<string>();
    if (assigned.length) {
      for (const s of assigned) {
        const id = norm(s.stageId);
        if (id) stageIds.add(id);
      }
    } else {
      for (const s of attempts) {
        const id = norm(s.stageId);
        if (id) stageIds.add(id);
      }
      const currentId = norm(app.currentStageId);
      // Avoid a second shell when current stage is already covered by an attempt.
      if (currentId && !stageIds.has(currentId)) {
        stageIds.add(currentId);
      }
    }

    const byId = new Map<string, JobProfileStageMysql>();

    const overlayName = (stage: JobProfileStageMysql): JobProfileStageMysql => {
      const sid = norm(stage.id);
      const attempt =
        attempts.find((s) => norm(s.stageId) === sid) ??
        attempts.find(
          (s) =>
            Boolean(s.stageKey) &&
            Boolean(stage.stageKey) &&
            s.stageKey === stage.stageKey &&
            // Don't let a take-home attempt relabel a coding stage via loose key match.
            String(s.stageType) === String(stage.stageType),
        );
      const asg = assigned.find((s) => norm(s.stageId) === sid);
      const snap = attempt ?? asg;
      if (!snap) return stage;
      return Object.assign(Object.create(Object.getPrototypeOf(stage)), stage, {
        name: snap.stageName,
        stageType: snap.stageType as JobStageType,
        sortOrder: snap.sortOrder ?? stage.sortOrder,
      }) as JobProfileStageMysql;
    };

    for (const id of stageIds) {
      if (!id) continue;
      const stage = allStages.find((s) => norm(s.id) === id);
      if (stage) {
        byId.set(norm(stage.id), overlayName(stage));
        continue;
      }
      const snap =
        attempts.find((s) => norm(s.stageId) === id) ??
        assigned.find((s) => norm(s.stageId) === id);
      if (!snap) continue;
      const synthId = norm(snap.stageId) || norm(snap.id);
      byId.set(synthId, {
        id: synthId,
        jobProfileId: String(app.jobProfileId),
        stageKey: snap.stageKey ?? `snap_${snap.id}`,
        name: snap.stageName,
        description: null,
        sortOrder: snap.sortOrder,
        mode: undefined as never,
        mandatory: 1,
        stageType: snap.stageType as JobStageType,
        skipRules: null,
        roundConfig: null,
        createdAt: snap.createdAt,
        updatedAt: snap.updatedAt,
        inactive: 1,
        profile: undefined as never,
      } as unknown as JobProfileStageMysql);
    }

    // Legacy only: collapse duplicate types. Assigned pipelines are intentional — keep as-is.
    const list = [...byId.values()];
    const deduped = assigned.length
      ? list
      : this.dedupePipelineStages(list, attempts);

    return deduped.sort(
      (a, b) =>
        Number(a.sortOrder) - Number(b.sortOrder) || Number(a.id) - Number(b.id),
    );
  }

  /**
   * Prefer attempt-backed stages; keep a single take_home / coding / verbal slot
   * when legacy data produced duplicates.
   */
  private dedupePipelineStages(
    stages: JobProfileStageMysql[],
    attempts: ApplicationRoundSnapshotMysql[],
  ): JobProfileStageMysql[] {
    const attemptStageIds = new Set(
      attempts.map((s) => String(s.stageId ?? '')).filter(Boolean),
    );
    const byType = new Map<string, JobProfileStageMysql>();

    const rank = (s: JobProfileStageMysql) => {
      if (attemptStageIds.has(String(s.id))) return 0;
      if (Number(s.inactive) !== 0) return 1;
      return 2;
    };

    for (const stage of stages) {
      const typeKey = String(stage.stageType);
      // Unique types that must not repeat on a report/portal timeline.
      const collapse =
        typeKey === JobStageType.TAKE_HOME ||
        typeKey === JobStageType.CODING ||
        typeKey === JobStageType.AI_VERBAL ||
        typeKey === JobStageType.HR_VERBAL ||
        typeKey === JobStageType.SCREENING ||
        typeKey === JobStageType.PROJECT_INTERVIEW;

      if (!collapse) {
        byType.set(`${typeKey}:${stage.id}`, stage);
        continue;
      }

      const prev = byType.get(typeKey);
      if (!prev || rank(stage) < rank(prev)) {
        byType.set(typeKey, stage);
      }
    }

    return [...byType.values()];
  }

  private async findStageForCoding(
    jobProfileId: string,
    stageKey: string,
  ): Promise<JobProfileStageMysql | null> {
    const matches = await this.stages.find({
      where: { jobProfileId: String(jobProfileId), stageKey },
      order: { sortOrder: 'ASC' },
    });
    if (!matches.length) return null;
    return (
      matches.find((s) => s.inactive !== 0) ??
      matches.find((s) => s.inactive === 0) ??
      matches[0] ??
      null
    );
  }

  private interviewHasAttempt(interview: CandidateAutonomousInterviewMysql): boolean {
    if (Number(interview.stage1VoiceScore ?? 0) > 0) return true;
    if (interview.codeQualityScore != null) return true;
    if (interview.stage1VoiceAudit) return true;
    if (interview.screeningVoiceAudit) return true;
    if (interview.hrVoiceAudit) return true;
    if (interview.recordingUrl) return true;
    const chat = interview.stage1ChatHistory;
    if (Array.isArray(chat) && chat.length > 0) return true;
    if (chat && typeof chat === 'object' && Object.keys(chat as object).length > 0) {
      return true;
    }
    const stage3 = interview.stage3ChatHistory;
    if (Array.isArray(stage3) && stage3.length > 0) return true;
    const phase = String(interview.currentPhase ?? '');
    return Boolean(phase && phase !== 'intro_verbal');
  }

  private pickVerbalStage(
    stages: JobProfileStageMysql[],
    app: JobApplicationMysql,
    interview: CandidateAutonomousInterviewMysql,
  ): JobProfileStageMysql | undefined {
    const verbal = stages.filter(
      (s) =>
        s.stageType === JobStageType.SCREENING ||
        s.stageType === JobStageType.AI_SCREENING ||
        s.stageType === JobStageType.AI_VERBAL ||
        s.stageType === JobStageType.HR_VERBAL ||
        s.stageType === JobStageType.PROJECT_INTERVIEW,
    );

    // Prefer the stage frozen onto the session at Start Round.
    const proctor = (interview.proctorSummary as Record<string, unknown> | null) ?? {};
    const proctorStageId = proctor.stageId != null ? String(proctor.stageId) : '';
    if (proctorStageId) {
      const pinned = verbal.find((s) => String(s.id) === proctorStageId);
      if (pinned) return pinned;
    }

    const hasScreening =
      interview.screeningVoiceAudit != null &&
      typeof interview.screeningVoiceAudit === 'object';
    const hasHr =
      interview.hrVoiceAudit != null && typeof interview.hrVoiceAudit === 'object';
    const hasTech =
      interview.stage1VoiceAudit != null && typeof interview.stage1VoiceAudit === 'object';

    const current = stages.find((s) => String(s.id) === String(app.currentStageId ?? ''));
    if (
      current &&
      (current.stageType === JobStageType.AI_SCREENING ||
        current.stageType === JobStageType.AI_VERBAL ||
        current.stageType === JobStageType.HR_VERBAL)
    ) {
      // Only trust currentStageId when evidence matches that stage family.
      if (current.stageType === JobStageType.AI_SCREENING && (hasScreening || (!hasHr && !hasTech))) {
        return current;
      }
      if (current.stageType === JobStageType.HR_VERBAL && hasHr) return current;
      if (current.stageType === JobStageType.AI_VERBAL && hasTech) return current;
    }

    const phase = String(interview.currentPhase ?? '');
    const isBnd =
      phase === 'bnd_assessment' ||
      phase === 'bnd_interview' ||
      (interview.proctorSummary as Record<string, unknown> | null)?.bndPhase != null ||
      (interview.proctorSummary as Record<string, unknown> | null)?.stageType ===
        JobStageType.PROJECT_INTERVIEW;

    const preferred: JobStageType[] = isBnd
      ? [
          JobStageType.PROJECT_INTERVIEW,
          JobStageType.AI_VERBAL,
          JobStageType.AI_SCREENING,
          JobStageType.HR_VERBAL,
        ]
      : hasScreening
        ? [JobStageType.AI_SCREENING, JobStageType.AI_VERBAL, JobStageType.HR_VERBAL]
        : hasHr || phase === 'hr_verbal'
          ? [JobStageType.HR_VERBAL, JobStageType.AI_VERBAL, JobStageType.AI_SCREENING]
          : phase === 'ai_screening'
            ? [JobStageType.AI_SCREENING, JobStageType.AI_VERBAL, JobStageType.HR_VERBAL]
            : [JobStageType.AI_VERBAL, JobStageType.AI_SCREENING, JobStageType.HR_VERBAL];

    for (const type of preferred) {
      const hist = verbal.filter((s) => s.stageType === type && s.inactive !== 0);
      if (hist.length) return hist[hist.length - 1];
      const live = verbal.filter((s) => s.stageType === type && s.inactive === 0);
      if (live.length) return live[0];
    }
    return verbal.find((s) => s.stageType === JobStageType.SCREENING);
  }
}
