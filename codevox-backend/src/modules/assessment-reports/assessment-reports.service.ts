import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OpenAiClientService } from '../assessment-platform/assessment-ai/openai-client.service';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import {
  CandidateAutonomousInterviewMysql,
  AutonomousInterviewPhase,
} from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import {
  AutonomousInterviewRoundType,
} from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { AutonomousInterviewRoundsRepository } from '../autonomous-interview/autonomous-interview-rounds.repository';
import { toRecordingPlaybackUrl } from '../autonomous-interview/recording-playback';
import { CodingRoundSubmissionEntity } from '../coding-round/coding-round-submission.entity';
import {
  JobApplicationMysql,
  JobApplicationStatus,
} from '../job-profiles/entities/job-application.mysql.entity';
import { JobProfileMysql } from '../job-profiles/entities/job-profile.mysql.entity';
import {
  JobProfileStageMysql,
  JobStageType,
} from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { ProblemBankProblemMysql } from '../job-profiles/entities/problem-bank-problem.mysql.entity';
type TakeHomeSubmissionMysql = any;
type TakeHomeEvalRunMysql = any;
const TakeHomeSubmissionStatus = {
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  GRADING: 'grading',
  GRADED: 'graded',
  EVALUATED: 'evaluated',
  FAILED: 'failed',
  EXPIRED: 'expired',
} as const;
import { ApplicationRoundSnapshotMysql } from './entities/application-round-snapshot.mysql.entity';
import { ROUND_SOURCE, RoundSnapshotService } from './round-snapshot.service';
import {
  ProjectInterviewService,
  type ProjectStageMeta,
} from '../project-interview/project-interview.service';
import { ProjectInterviewStatus } from '../project-interview/entities/project-interview-submission.mysql.entity';
import { RecruitmentLeadOverlayMysql } from '../recruitment/entities/recruitment-lead-overlay.mysql.entity';
import type {
  AssessmentReportDetail,
  AssessmentReportListItem,
  AssessmentReportsListFilters,
  AssessmentReportsListResponse,
  AssessmentReportsSummary,
  AssessmentStageReport,
  CodingQuestionReport,
  CodingStageReport,
  GenericStageReport,
  IntegrityDisqualification,
  NormalizedAiEvaluation,
  Recommendation,
  ReportStatus,
  RoundSummaryItem,
  StageEvalStatus,
  TakeHomeStageReport,
  VerbalStageReport,
  AiScreeningStageReport,
  OverallEvaluation,
  OverallEvidenceItem,
  OverallHireDecision,
} from './assessment-reports.types';
import {
  computeWeightedOverallScore,
  heuristicOverallDecision,
  isHighPriorityStage,
  isLowPriorityStage,
  isOverallEvaluation,
  computeCompositeShortlistScore,
  determineShortlistBadge,
  ShortlistBadge,
} from './overall-evaluation';

type TestCaseLike = {
  passed?: boolean;
  time_ms?: number;
  timeMs?: number;
};

type ProblemSubmissionLike = {
  language?: string;
  sourceCode?: string;
  testResults?: TestCaseLike[] | null;
  scorePct?: number | null;
  aiFeedback?: string;
  runtimeMs?: number;
  memoryMb?: number;
};

@Injectable()
export class AssessmentReportsService {
  private readonly logger = new Logger(AssessmentReportsService.name);

  constructor(
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(JobProfileMysql)
    private readonly profiles: Repository<JobProfileMysql>,
    @InjectRepository(JobProfileStageMysql)
    private readonly stages: Repository<JobProfileStageMysql>,
    @InjectRepository(CandidateMysql)
    private readonly candidates: Repository<CandidateMysql>,
    @InjectRepository(CodingRoundSubmissionEntity)
    private readonly codingSubs: Repository<CodingRoundSubmissionEntity>,
    @InjectRepository(CandidateAutonomousInterviewMysql)
    private readonly interviews: Repository<CandidateAutonomousInterviewMysql>,
    @InjectRepository(ProblemBankProblemMysql)
    private readonly problems: Repository<ProblemBankProblemMysql>,
    @InjectRepository(RecruitmentLeadOverlayMysql)
    private readonly overlays: Repository<RecruitmentLeadOverlayMysql>,
    private readonly roundSnapshots: RoundSnapshotService,
    private readonly projectInterview: ProjectInterviewService,
    private readonly interviewRounds: AutonomousInterviewRoundsRepository,
    private readonly openai: OpenAiClientService,
  ) { }

  /** Attach per-round audits / merged videos onto master interview rows. */
  private async hydrateInterviewRounds(
    rows: CandidateAutonomousInterviewMysql[],
  ): Promise<CandidateAutonomousInterviewMysql[]> {
    await Promise.all(
      rows.map(async (row) => {
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
        (row as CandidateAutonomousInterviewMysql & {
          roundMergedUrls?: Partial<Record<AutonomousInterviewRoundType, string | null>>;
        }).roundMergedUrls = {
          [AutonomousInterviewRoundType.AI_SCREENING]: screening?.mergedRecordingUrl ?? null,
          [AutonomousInterviewRoundType.HR_VERBAL]: hr?.mergedRecordingUrl ?? null,
          [AutonomousInterviewRoundType.INTRO_VERBAL]: intro?.mergedRecordingUrl ?? null,
          [AutonomousInterviewRoundType.BND_INTERVIEW]: bnd?.mergedRecordingUrl ?? null,
        };
      }),
    );
    return rows;
  }

  private roundRecordingUrl(
    interview: CandidateAutonomousInterviewMysql | null,
    roundType: AutonomousInterviewRoundType,
  ): string | null {
    if (!interview) return null;
    const urls = (
      interview as CandidateAutonomousInterviewMysql & {
        roundMergedUrls?: Partial<Record<AutonomousInterviewRoundType, string | null>>;
      }
    ).roundMergedUrls;
    return urls?.[roundType] ?? interview.recordingUrl ?? null;
  }

  async summary(filters: AssessmentReportsListFilters = {}): Promise<AssessmentReportsSummary> {
    const { items } = await this.buildFilteredItems(filters, { paginate: false });
    const withScore = items.filter((i) => i.overallScorePct != null);
    const avg =
      withScore.length > 0
        ? withScore.reduce((s, i) => s + (i.overallScorePct ?? 0), 0) / withScore.length
        : null;
    return {
      totalCandidates: items.length,
      completedCount: items.filter((i) => i.reportStatus === 'passed' || i.reportStatus === 'failed').length,
      activeCandidates: items.filter(
        (i) => i.reportStatus === 'in_progress' || i.reportStatus === 'under_review',
      ).length,
      avgCohortScorePct: avg != null ? Math.round(avg * 10) / 10 : null,
      strongHireCount: items.filter((i) => i.recommendation === 'strong_hire').length,
      pendingReviewCount: items.filter((i) => i.reportStatus === 'under_review').length,
    };
  }

  async getProfilesStats(jobProfileIds: string[]) {
    if (!jobProfileIds.length) return {};

    // Naive implementation for now: fetch summary for each profile
    // Since this is paginated to a small number of active profiles, it's acceptable for MVP
    const results: Record<string, AssessmentReportsSummary> = {};
    for (const id of jobProfileIds) {
      results[id] = await this.summary({ jobProfileId: id });
    }
    return results;
  }

  async list(filters: AssessmentReportsListFilters = {}): Promise<AssessmentReportsListResponse> {
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 10));
    const { items, total } = await this.buildFilteredItems(filters, {
      paginate: true,
      page,
      pageSize,
    });
    return { items, total, page, pageSize };
  }

  async getDetail(applicationId: string): Promise<AssessmentReportDetail> {
    const app = await this.applications.findOne({
      where: { id: applicationId, inactive: 0 },
    });
    if (!app) throw new NotFoundException('Application not found');

    // Allow report generation even if job profile or candidate was later marked inactive/archived
    const [profile, candidate, profileStages] = await Promise.all([
      this.profiles.findOne({ where: { id: app.jobProfileId } }),
      this.candidates.findOne({ where: { id: app.candidateId } }),
      this.stages.find({
        where: { jobProfileId: app.jobProfileId },
        order: { sortOrder: 'ASC' },
      }),
    ]);
    if (!profile) throw new NotFoundException('Job profile not found');
    if (!candidate) throw new NotFoundException('Candidate not found');

    const [codingRows, takeHomeRows, interviews, overlay] = await Promise.all([
      this.codingSubs.find({
        where: { applicationId: String(app.id), inactive: false },
      }),
      Promise.resolve([] as any[]),
      this.loadInterviewsForPortalToken(app.candidateToken),
      this.overlays.findOne({
        where: { leadId: `app:${app.id}` },
      }),
    ]);

    const problemIds = new Set<string>();
    for (const row of codingRows) {
      for (const pid of Object.keys(row.problemSubmissions ?? {})) problemIds.add(pid);
      for (const pid of row.assignedProblemIds ?? []) problemIds.add(String(pid));
    }
    const problemMap = await this.loadProblems([...problemIds]);

    // Prefer frozen attempt snapshots (name/type at attempt time), then augment
    // with pending stages from the apply-time pipeline.
    const snapshots = await this.roundSnapshots.ensureForApplication(String(app.id));
    const reportStages = this.mergeReportStages({
      application: app,
      profileStages,
      snapshots,
      codingRows,
      takeHomeRows,
      interviews,
    });

    const stages: AssessmentStageReport[] = [];
    for (const stage of reportStages) {
      const snap = this.findSnapshotForStage(snapshots, stage);
      const evidence = this.evidenceForStage({
        stage,
        snap,
        snapshots,
        codingRows,
        takeHomeRows,
        interviews,
        application: app,
      });
      const built = await this.buildStageReport({
        stage,
        codingRows: evidence.codingRows,
        takeHomeRows: evidence.takeHomeRows,
        interview: evidence.interview,
        candidateToken: app.candidateToken,
        applicationId: String(app.id),
        problemMap,
      });
      if (snap) {
        built.label = snap.stageName;
        (built as { stageType: string }).stageType = snap.stageType;
        if (snap.scorePct != null) {
          const snapScore = Number(snap.scorePct);
          if (built.scorePct == null || Number.isNaN(built.scorePct)) {
            built.scorePct = snapScore;
          } else if (
            built.scorePct === Math.round(snapScore) &&
            snapScore % 1 !== 0
          ) {
            built.scorePct = snapScore;
          }
        }
      }
      stages.push(built);
    }

    const resumeScore =
      overlay?.resumeMatchScore != null ? Number(overlay.resumeMatchScore) : null;
    const completedScores = stages
      .map((s) => s.scorePct)
      .filter((s): s is number => typeof s === 'number' && !Number.isNaN(s));
    const overallScorePct =
      completedScores.length > 0
        ? Math.round(
          (completedScores.reduce((a, b) => a + b, 0) / completedScores.length) * 10,
        ) / 10
        : null;
    const { weightedScorePct, sourceWeights } = computeWeightedOverallScore({
      stages: stages.map((s) => ({
        stageType: s.stageType,
        scorePct: s.scorePct,
        label: s.label,
      })),
      resumeScore,
    });

    let integrityDisqualification: IntegrityDisqualification | null = null;
    for (const stageReport of stages) {
      if ('integrityDisqualification' in stageReport && stageReport.integrityDisqualification?.disqualified) {
        integrityDisqualification = stageReport.integrityDisqualification;
        break;
      }
    }
    if (!integrityDisqualification) {
      for (const i of interviews) {
        const ps = (i.proctorSummary ?? {}) as Record<string, unknown>;
        const byType = (ps.by_type ?? {}) as Record<string, number>;
        const isTerminated = (byType['media_permission_terminated'] ?? 0) > 0;
        const isDisqualified =
          (isTerminated || String(i.finalDecision) === 'DISQUALIFIED') &&
          !ps.retake_allowed;
        if (isDisqualified) {
          integrityDisqualification = {
            disqualified: true,
            reason: isTerminated ? 'Proctoring integrity violation' : 'Integrity risk detected',
            details: isTerminated
              ? 'The session was closed after excessive camera or microphone interruptions.'
              : 'Suspicious proctoring activity was detected during the assessment.',
            stageName: (ps.bndPhase === 'defend' || ps.stageType === 'project_interview')
              ? 'Build & Defend'
              : 'Autonomous Interview',
            stageId: ps.stageId ? String(ps.stageId) : undefined,
            sessionToken: i.candidateToken,
            eventTime: ps.last_event_at ? String(ps.last_event_at) : undefined,
            fraudRiskScore: Number(ps.fraud_risk_score ?? 0),
            criticalCount: Number(ps.critical_count ?? 0),
            totalEvents: Number(ps.total_events ?? 0),
          };
          break;
        }
      }
    }

    const overlayOverride = (overlay?.aiQualificationJson as Record<string, unknown> | null)?.integrityOverride as
      | { action?: string; note?: string; decidedAt?: string }
      | undefined;

    let recommendation: Recommendation;
    if (integrityDisqualification) {
      if (overlayOverride?.action === 'disqualify') {
        integrityDisqualification.status = 'disqualified';
        integrityDisqualification.disqualified = true;
        integrityDisqualification.overrideAction = 'disqualify';
        integrityDisqualification.overrideNote = overlayOverride.note;
        integrityDisqualification.overrideAt = overlayOverride.decidedAt;
        recommendation = 'disqualified';
      } else if (overlayOverride?.action === 'allow_retake') {
        integrityDisqualification.status = 'retake';
        integrityDisqualification.disqualified = false;
        integrityDisqualification.overrideAction = 'allow_retake';
        integrityDisqualification.overrideNote = overlayOverride.note;
        integrityDisqualification.overrideAt = overlayOverride.decidedAt;
        recommendation = 'retake';
      } else {
        integrityDisqualification.status = 'flagged';
        integrityDisqualification.disqualified = true;
        recommendation = 'flagged';
      }
    } else {
      recommendation = this.computeRecommendation({
        overallScorePct: weightedScorePct ?? overallScorePct,
        pendingHumanReview: Boolean(app.pendingHumanReview),
        applicationStatus: app.status,
        stages,
      });
    }

    let actionRequired = this.buildActionRequired(app, stages);
    if (integrityDisqualification) {
      if (integrityDisqualification.status === 'flagged') {
        actionRequired = {
          message: 'Action required: Candidate flagged for proctoring integrity violation. Recruiter decision needed.',
        };
      } else if (integrityDisqualification.status === 'disqualified') {
        actionRequired = {
          message: 'Candidate disqualified by recruiter override.',
        };
      } else if (integrityDisqualification.status === 'retake') {
        actionRequired = {
          message: 'Retake allowed by recruiter override.',
        };
      }
    }
    const durations = stages
      .map((s) => ('durationMinutes' in s ? s.durationMinutes : null))
      .filter((d): d is number => typeof d === 'number');
    const totalDurationMinutes =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null;

    const scoreForRank = weightedScorePct ?? overallScorePct;
    const cohortRank = await this.computeCohortRank(app.jobProfileId, scoreForRank);

    const detailBase = {
      application: {
        id: String(app.id),
        status: app.status,
        pendingHumanReview: Boolean(app.pendingHumanReview),
        autoAction: app.autoAction,
        candidateToken: app.candidateToken,
        appliedAt: app.appliedAt.toISOString(),
        totalDurationMinutes,
      },
      candidate: {
        id: String(candidate.id),
        name: this.candidateName(candidate),
        email: candidate.email,
        phone: candidate.phone ?? null,
        linkedinUrl: null,
        initials: this.initials(this.candidateName(candidate)),
      },
      jobProfile: { id: String(profile.id), title: profile.title },
      overallScorePct,
      weightedScorePct,
      overallPoints:
        overallScorePct != null
          ? { earned: Math.round(overallScorePct * 10) / 10, total: 100 }
          : null,
      resumeScore,
      cohortRank,
      recommendation,
      actionRequired,
      integrityDisqualification,
      stages,
    };

    const overallEvaluation = await this.ensureOverallEvaluation(app, {
      ...detailBase,
      sourceWeights,
      jobProfileEntity: profile,
    });

    return {
      ...detailBase,
      overallEvaluation,
    };
  }

  /**
   * Build and persist the cross-round hire evaluation once all rounds are done.
   * Safe to call repeatedly; skips when already stored unless force=true.
   */
  async ensureOverallEvaluationForApplication(
    applicationId: string,
    options?: { force?: boolean },
  ): Promise<OverallEvaluation | null> {
    if (options?.force) {
      await this.applications.update(
        { id: applicationId },
        { overallEvaluation: null } as Parameters<
          Repository<JobApplicationMysql>['update']
        >[1],
      );
    }
    const detail = await this.getDetail(applicationId);
    return detail.overallEvaluation ?? null;
  }

  private async ensureOverallEvaluation(
    app: JobApplicationMysql,
    context: {
      application: AssessmentReportDetail['application'];
      candidate: AssessmentReportDetail['candidate'];
      jobProfile: AssessmentReportDetail['jobProfile'];
      jobProfileEntity?: JobProfileMysql | null;
      overallScorePct: number | null;
      weightedScorePct: number | null;
      resumeScore: number | null;
      recommendation: Recommendation;
      integrityDisqualification?: IntegrityDisqualification | null;
      stages: AssessmentStageReport[];
      sourceWeights: Record<string, number>;
    },
  ): Promise<OverallEvaluation | null> {
    const terminal =
      app.status === JobApplicationStatus.COMPLETED ||
      app.status === JobApplicationStatus.HIRED ||
      app.status === JobApplicationStatus.REJECTED;
    if (!terminal) {
      return isOverallEvaluation(app.overallEvaluation)
        ? (app.overallEvaluation as OverallEvaluation)
        : null;
    }
    if (isOverallEvaluation(app.overallEvaluation)) {
      return app.overallEvaluation as OverallEvaluation;
    }
    const evaluation = await this.buildOverallEvaluation({
      detail: {
        application: context.application,
        candidate: context.candidate,
        jobProfile: context.jobProfile,
        overallScorePct: context.overallScorePct,
        weightedScorePct: context.weightedScorePct,
        resumeScore: context.resumeScore,
        recommendation: context.recommendation,
        integrityDisqualification: context.integrityDisqualification ?? null,
        stages: context.stages,
      },
      weightedScorePct: context.weightedScorePct,
      sourceWeights: context.sourceWeights,
      jobProfileEntity: context.jobProfileEntity,
    });
    if (evaluation) {
      const stored = evaluation as unknown as Record<string, unknown>;
      await this.applications.update(
        { id: app.id },
        { overallEvaluation: stored } as Parameters<
          Repository<JobApplicationMysql>['update']
        >[1],
      );
      app.overallEvaluation = stored;
    }
    return evaluation;
  }

  private async buildOverallEvaluation(input: {
    detail: Pick<
      AssessmentReportDetail,
      | 'application'
      | 'candidate'
      | 'jobProfile'
      | 'overallScorePct'
      | 'weightedScorePct'
      | 'resumeScore'
      | 'recommendation'
      | 'integrityDisqualification'
      | 'stages'
    >;
    weightedScorePct: number | null;
    sourceWeights: Record<string, number>;
    jobProfileEntity?: JobProfileMysql | null;
  }): Promise<OverallEvaluation> {
    const heuristic = this.heuristicOverallEvaluation(input);
    try {
      const llm = await this.llmOverallEvaluation(input, heuristic);
      if (llm) return llm;
    } catch (error) {
      this.logger.warn(
        `Overall evaluation LLM failed for app=${input.detail.application.id}: ${error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return heuristic;
  }

  private heuristicOverallEvaluation(input: {
    detail: Pick<
      AssessmentReportDetail,
      | 'application'
      | 'candidate'
      | 'jobProfile'
      | 'overallScorePct'
      | 'weightedScorePct'
      | 'resumeScore'
      | 'recommendation'
      | 'integrityDisqualification'
      | 'stages'
    >;
    weightedScorePct: number | null;
    sourceWeights: Record<string, number>;
    jobProfileEntity?: JobProfileMysql | null;
  }): OverallEvaluation {
    const whyHire: OverallEvidenceItem[] = [];
    const whyNotHire: OverallEvidenceItem[] = [];
    const score = input.weightedScorePct;

    // 1. Resume Background (qualitative evidence, no score numbers)
    if (typeof input.detail.resumeScore === 'number') {
      if (input.detail.resumeScore >= 70) {
        whyHire.push({
          source: 'Resume Profile',
          stageType: 'resume',
          headline: 'Relevant Domain Alignment',
          competency: 'Domain Experience',
          detail: `Candidate profile and claimed technical background show verified alignment with core requirements for ${input.detail.jobProfile.title}.`,
        });
      } else if (input.detail.resumeScore < 50) {
        whyNotHire.push({
          source: 'Resume Profile',
          stageType: 'resume',
          headline: 'Prerequisite Experience Gaps',
          competency: 'Domain Experience',
          detail: `Resume lacks evidence of hands-on experience in several prerequisite technologies outlined for ${input.detail.jobProfile.title}.`,
        });
      }
    }

    // 2. Iterate Stages for Qualitative Evidence
    for (const stage of input.detail.stages) {
      const strengths =
        'aiEvaluation' in stage && Array.isArray(stage.aiEvaluation?.strengths)
          ? stage.aiEvaluation!.strengths
          : [];
      const improvements =
        'aiEvaluation' in stage && Array.isArray(stage.aiEvaluation?.improvements)
          ? stage.aiEvaluation!.improvements
          : [];

      // AI Screening / PSV Round Evidence
      if (stage.stageType === 'ai_screening') {
        const screeningStage = stage as AiScreeningStageReport;
        const checks = Array.isArray(screeningStage.checks) ? screeningStage.checks : [];
        const flaggedChecks = checks.filter((c: any) => c.status === 'flag' || c.flagged === true || c.failed === true);

        if (flaggedChecks.length > 0) {
          const checkLabels = flaggedChecks
            .map((c: any) => c.label || c.requirement || 'Requirement check')
            .slice(0, 2)
            .join('; ');
          whyNotHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: 'Screening Requirement Flag',
            competency: 'Role Fit',
            detail: `Candidate flagged on initial role prerequisites: ${checkLabels}.`,
          });
        } else if (checks.length > 0) {
          whyHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: 'Role Prerequisite & Communication Alignment',
            competency: 'Role Fit',
            detail: 'Candidate verified all core role prerequisites, work-mode expectations, and articulated clear background context during initial screening.',
          });
        }
      }

      // Coding Round Evidence
      if (stage.stageType === 'coding') {
        const codingStage = stage as CodingStageReport;
        const passedCount = codingStage.questionsPassed ?? 0;
        const totalCount = codingStage.questionsTotal ?? 0;

        if (totalCount > 0 && passedCount === totalCount) {
          whyHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: 'Robust Algorithmic Implementation',
            competency: 'Technical Problem Solving',
            detail: 'Successfully passed all technical problem constraints and test cases with verified algorithmic correctness.',
          });
        } else if (totalCount > 0 && passedCount < totalCount) {
          whyNotHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: 'Edge-Case & Algorithm Vulnerabilities',
            competency: 'Technical Problem Solving',
            detail: `Failed automated verification on ${totalCount - passedCount} of ${totalCount} assigned technical coding problems.`,
          });
        }
      }

      // Build & Defend (Project Interview) Evidence
      if (stage.stageType === 'project_interview') {
        const verbalStage = stage as VerbalStageReport;
        const proj = verbalStage.project;
        if (proj) {
          if (typeof proj.code_build_score_pct === 'number' && proj.code_build_score_pct >= 70) {
            whyHire.push({
              source: stage.label,
              stageType: stage.stageType,
              headline: 'Hands-on Project Implementation',
              competency: 'System Implementation',
              detail: `Successfully completed project implementation for "${proj.project_title || 'Assigned Project'}" with clean repository structure and verified build completion.`,
            });
          }
          if (typeof proj.verbal_defend_score_pct === 'number' && proj.verbal_defend_score_pct >= 70) {
            whyHire.push({
              source: stage.label,
              stageType: stage.stageType,
              headline: 'Project Architecture Defense',
              competency: 'Architectural Defense',
              detail: `Articulated clear design reasoning and trade-off justifications for "${proj.project_title || 'Assigned Project'}" during live interrogation.`,
            });
          } else if (typeof proj.verbal_defend_score_pct === 'number' && proj.verbal_defend_score_pct < 55) {
            whyNotHire.push({
              source: stage.label,
              stageType: stage.stageType,
              headline: 'Shallow Project Defense',
              competency: 'Architectural Defense',
              detail: `Struggled to articulate technical decisions or trade-offs behind the submitted code during the live defense round.`,
            });
          }
          if (
            typeof proj.code_build_score_pct === 'number' &&
            typeof proj.verbal_defend_score_pct === 'number' &&
            proj.code_build_score_pct - proj.verbal_defend_score_pct >= 30
          ) {
            whyNotHire.push({
              source: stage.label,
              stageType: stage.stageType,
              headline: 'Code vs. Defense Divergence',
              competency: 'Code Authorship & Depth',
              detail: `Noticeable divergence between submitted codebase complexity and candidate's ability to explain implementation details in the defense interview.`,
            });
          }
        }
      }

      // AI Verbal / Interview Evidence
      if (
        stage.stageType === 'ai_verbal' ||
        stage.stageType === 'project_interview' ||
        stage.stageType === 'hr_verbal' ||
        stage.stageType === 'screening'
      ) {
        const verbalStage = stage as VerbalStageReport;
        const comps = Array.isArray(verbalStage.competencies) ? verbalStage.competencies : [];
        const topComps = comps.filter((c) => typeof c.scorePct === 'number' && c.scorePct >= 70);
        const weakComps = comps.filter((c) => typeof c.scorePct === 'number' && c.scorePct < 60);

        for (const comp of topComps.slice(0, 2)) {
          whyHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: `${comp.label} Execution`,
            competency: comp.label,
            detail: comp.note || `Demonstrated solid conceptual depth and structured reasoning in ${comp.label}.`,
          });
        }

        for (const comp of weakComps.slice(0, 2)) {
          whyNotHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: `${comp.label} Depth Gap`,
            competency: comp.label,
            detail: comp.note || `Exhibited conceptual gaps or shallow troubleshooting experience in ${comp.label}.`,
          });
        }

        if (!topComps.length && strengths.length) {
          whyHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: 'Key Technical Strength',
            competency: 'Technical Capability',
            detail: strengths[0],
          });
        }
        if (!weakComps.length && improvements.length) {
          whyNotHire.push({
            source: stage.label,
            stageType: stage.stageType,
            headline: 'Identified Skill Gap',
            competency: 'Technical Capability',
            detail: improvements[0],
          });
        }
      }
    }

    // 3. Proctoring & Integrity (Always Top Priority in whyNotHire if Disqualified)
    if (input.detail.integrityDisqualification?.disqualified) {
      whyNotHire.unshift({
        source: 'Integrity Proctoring',
        stageType: input.detail.integrityDisqualification.stageName ?? null,
        headline: 'Integrity & Proctoring Violation',
        competency: 'Integrity',
        detail: input.detail.integrityDisqualification.reason,
      });
    }

    // Clean fallback if no material concerns
    if (!whyNotHire.length) {
      whyNotHire.push({
        source: 'Overall Evaluation',
        stageType: null,
        headline: 'No Material Concerns',
        competency: 'Overall Fit',
        detail: 'No material technical concerns or behavioral red flags were recorded across completed rounds.',
      });
    }

    // Strictly limit to the top 2-3 most decisive reasons each (max 6 points total)
    const trimmedWhyHire = whyHire.slice(0, 3);
    const trimmedWhyNotHire = whyNotHire.slice(0, 3);

    // Decision
    let decision: OverallHireDecision = heuristicOverallDecision(score);
    if (input.detail.integrityDisqualification?.disqualified) {
      decision = 'do_not_hire';
    } else if (input.detail.recommendation === 'under_review' || input.detail.application.pendingHumanReview) {
      decision = 'under_review';
    } else if (input.detail.recommendation === 'reject' || input.detail.recommendation === 'disqualified') {
      decision = 'do_not_hire';
    } else if (input.detail.recommendation === 'strong_hire') {
      decision = 'strong_hire';
    } else if (input.detail.recommendation === 'hire') {
      decision = 'hire';
    }

    // Holistic score calculation: heuristic baseline
    let holisticScore = score != null ? score : 65;
    if (trimmedWhyHire.length >= 2 && trimmedWhyNotHire.length === 1 && trimmedWhyNotHire[0].headline === 'No Material Concerns') {
      holisticScore = Math.max(holisticScore, 82);
    }

    const shortlistScore = computeCompositeShortlistScore({
      weightedScorePct: score,
      holisticScore,
    });

    const shortlistBadge = determineShortlistBadge({
      weightedScorePct: score,
      holisticScore,
      isDisqualified: input.detail.integrityDisqualification?.disqualified,
    });

    let shortlistRationale: string | null = null;
    if (shortlistBadge === 'hidden_gem') {
      shortlistRationale = 'Candidate demonstrated strong conceptual depth and structured reasoning across interview transcripts, indicating higher real-world capability than raw test score suggests.';
    } else if (shortlistBadge === 'top_pick') {
      shortlistRationale = 'Consistently superior performance across both objective assessments and qualitative technical evaluations.';
    }

    const summary =
      decision === 'strong_hire' || decision === 'hire'
        ? `Candidate demonstrated compelling role suitability with strong alignment against core requirements.`
        : decision === 'do_not_hire'
          ? `Candidate demonstrated notable gaps against required competencies for this position.`
          : `Candidate performance is under review. Holistic assessment recommended before final decision.`;

    return {
      decision,
      summary,
      whyHire: trimmedWhyHire,
      whyNotHire: trimmedWhyNotHire,
      weightedScorePct: score,
      sourceWeights: input.sourceWeights,
      generatedAt: new Date().toISOString(),
      generatedBy: 'heuristic',
      holisticScore,
      shortlistScore,
      shortlistBadge,
      shortlistRationale,
    };
  }

  private async llmOverallEvaluation(
    input: {
      detail: Pick<
        AssessmentReportDetail,
        | 'application'
        | 'candidate'
        | 'jobProfile'
        | 'overallScorePct'
        | 'weightedScorePct'
        | 'resumeScore'
        | 'recommendation'
        | 'integrityDisqualification'
        | 'stages'
      >;
      weightedScorePct: number | null;
      sourceWeights: Record<string, number>;
      jobProfileEntity?: JobProfileMysql | null;
    },
    fallback: OverallEvaluation,
  ): Promise<OverallEvaluation | null> {
    const profile = input.jobProfileEntity;
    const jdContext = {
      title: profile?.title || input.detail.jobProfile.title,
      seniorityLevel: profile?.seniorityLevel || null,
      department: profile?.department || null,
      requiredSkills: profile?.requiredSkills || [],
      niceToHaveSkills: profile?.niceToHaveSkills || [],
      responsibilities: Array.isArray(profile?.responsibilities) ? profile!.responsibilities.slice(0, 5) : [],
    };

    const stageBriefs = input.detail.stages.map((stage) => {
      const ai = 'aiEvaluation' in stage ? stage.aiEvaluation : null;
      let transcriptText = '';
      if ('transcript' in stage && Array.isArray(stage.transcript)) {
        transcriptText = stage.transcript
          .slice(0, 15)
          .map((t) => `${t.role}: ${String(t.text || '').slice(0, 250)}`)
          .join('\n');
      }
      let codingDetails: unknown = null;
      if (stage.stageType === 'coding' && 'questions' in stage) {
        codingDetails = (stage as CodingStageReport).questions.map((q) => ({
          title: q.title,
          language: q.language,
          testsPassed: q.testsPassed,
          testsTotal: q.testsTotal,
          feedback: q.aiEvaluation?.summary,
        }));
      }
      let screeningChecks: unknown = null;
      if (stage.stageType === 'ai_screening' && 'checks' in stage) {
        screeningChecks = (stage as AiScreeningStageReport).checks;
      }
      let projectDetails: unknown = null;
      if (stage.stageType === 'project_interview' && 'project' in stage && (stage as VerbalStageReport).project) {
        const proj = (stage as VerbalStageReport).project;
        projectDetails = {
          projectTitle: proj?.project_title,
          githubUrl: proj?.github_url,
          codeBuildScorePct: proj?.code_build_score_pct,
          verbalDefendScorePct: proj?.verbal_defend_score_pct,
          finalCombinedScorePct: proj?.final_combined_score_pct,
          projectProfile: proj?.project_profile,
        };
      }
      return {
        label: stage.label,
        stageType: stage.stageType,
        status: stage.status,
        summary: ai?.summary ?? null,
        strengths: ai?.strengths?.slice(0, 4) ?? [],
        improvements: ai?.improvements?.slice(0, 4) ?? [],
        transcriptExcerpt: transcriptText || null,
        codingDetails,
        screeningChecks,
        projectDetails,
      };
    });

    const result = await this.openai.chatJson<{
      decision?: string;
      summary?: string;
      why_hire?: Array<{ headline?: string; competency?: string; source?: string; stage_type?: string; detail?: string }>;
      why_not_hire?: Array<{ headline?: string; competency?: string; source?: string; stage_type?: string; detail?: string }>;
      holistic_score?: number;
      is_hidden_gem?: boolean;
      hidden_gem_rationale?: string;
      __isFallback?: boolean;
    }>([
      {
        role: 'system',
        content:
          'You are an executive talent committee evaluator. Produce a decisive, evidence-backed evaluation of the candidate against the Job Description (JD).\n' +
          'CRITICAL CONSTRAINTS:\n' +
          '1. DO NOT mention scores, points, numbers, or percentages anywhere in summary, why_hire, or why_not_hire (e.g. NEVER say "scored 70%", "score was 57%", etc.). Focus purely on real capability, depth, and observable behavior.\n' +
          '2. Provide EXACTLY 2 to 3 decisive points in why_hire, and 2 to 3 decisive points in why_not_hire. Total points must not exceed 6.\n' +
          '3. Each point must have a bold "headline" (2-5 words), "competency" (the JD skill it relates to), "source" (the round name), and "detail" (concrete evidence citing actual interview behavior, code quality, or screening responses).\n' +
          '4. Evaluate holistic_score (integer 0-100) reflecting real-world JD suitability and conceptual depth from transcripts (distinct from raw test scores).\n' +
          '5. If the candidate had partial test failures (e.g. score between 50% and 70%) but demonstrated outstanding conceptual depth, architecture knowledge, or articulate first-principles reasoning in transcripts, set is_hidden_gem=true and provide hidden_gem_rationale.\n' +
          '6. If the candidate has no significant flaws, why_not_hire must contain exactly one clean item with headline "No Material Concerns" and detail "No critical technical weaknesses or behavioral concerns were recorded."',
      },
      {
        role: 'user',
        content: `Evaluate this candidate for the role:\n${JSON.stringify({
          candidate: input.detail.candidate.name,
          jobProfile: jdContext,
          resumeScore: input.detail.resumeScore,
          integrity: input.detail.integrityDisqualification,
          stages: stageBriefs,
        })}`,
      },
    ]);

    if (!result || result.__isFallback) return null;
    const allowed: OverallHireDecision[] = [
      'strong_hire',
      'hire',
      'under_review',
      'do_not_hire',
    ];
    const decision = allowed.includes(result.decision as OverallHireDecision)
      ? (result.decision as OverallHireDecision)
      : fallback.decision;

    const mapItems = (
      rows: Array<{ headline?: string; competency?: string; source?: string; stage_type?: string; detail?: string }> | undefined,
      backup: OverallEvidenceItem[],
    ): OverallEvidenceItem[] => {
      const mapped = (rows ?? [])
        .map((row) => ({
          source: String(row.source || 'Evidence').slice(0, 120),
          stageType: row.stage_type ? String(row.stage_type) : null,
          headline: row.headline ? String(row.headline).slice(0, 120) : null,
          competency: row.competency ? String(row.competency).slice(0, 120) : null,
          detail: String(row.detail || '').slice(0, 500),
        }))
        .filter((row) => row.detail.trim().length > 0);
      return mapped.length ? mapped.slice(0, 3) : backup;
    };

    const holisticScore = typeof result.holistic_score === 'number'
      ? Math.min(100, Math.max(0, Math.round(result.holistic_score)))
      : fallback.holisticScore;

    const shortlistScore = computeCompositeShortlistScore({
      weightedScorePct: input.weightedScorePct,
      holisticScore,
    });

    let shortlistBadge: ShortlistBadge | null = determineShortlistBadge({
      weightedScorePct: input.weightedScorePct,
      holisticScore,
      isDisqualified: input.detail.integrityDisqualification?.disqualified,
    });

    if (result.is_hidden_gem && !input.detail.integrityDisqualification?.disqualified) {
      shortlistBadge = 'hidden_gem';
    }

    const shortlistRationale = result.hidden_gem_rationale || fallback.shortlistRationale || null;

    return {
      decision,
      summary: String(result.summary || fallback.summary).slice(0, 800),
      whyHire: mapItems(result.why_hire, fallback.whyHire),
      whyNotHire: mapItems(result.why_not_hire, fallback.whyNotHire),
      weightedScorePct: input.weightedScorePct,
      sourceWeights: input.sourceWeights,
      generatedAt: new Date().toISOString(),
      generatedBy: 'llm',
      holisticScore,
      shortlistScore,
      shortlistBadge,
      shortlistRationale,
    };
  }

  async applyIntegrityOverride(input: {
    applicationId: string;
    action: 'disqualify' | 'allow_retake';
    note?: string;
    user?: string;
  }) {
    const app = await this.applications.findOne({
      where: { id: input.applicationId, inactive: 0 },
    });
    if (!app) throw new NotFoundException('Application not found');

    let overlay = await this.overlays.findOne({
      where: { leadId: `app:${app.id}` },
    });
    if (!overlay) {
      overlay = this.overlays.create({
        leadId: `app:${app.id}`,
        aiQualificationJson: {},
      });
    }

    const currentJson = (overlay.aiQualificationJson ?? {}) as Record<string, unknown>;
    const integrityOverride = {
      action: input.action,
      note:
        input.note ||
        (input.action === 'disqualify'
          ? 'Disqualified by recruiter'
          : 'Retake allowed by recruiter'),
      decidedAt: new Date().toISOString(),
      decidedBy: input.user || 'recruiter',
    };

    overlay.aiQualificationJson = {
      ...currentJson,
      integrityOverride,
    };
    await this.overlays.save(overlay);

    if (input.action === 'disqualify') {
      app.status = JobApplicationStatus.REJECTED;
      await this.applications.save(app);
    } else if (input.action === 'allow_retake') {
      app.status = JobApplicationStatus.IN_PROGRESS;
      app.pendingHumanReview = 0;
      await this.applications.save(app);

      if (app.candidateToken) {
        const interviews = await this.interviews.find({
          where: { candidateToken: app.candidateToken },
        });
        for (const i of interviews) {
          const ps = (i.proctorSummary ?? {}) as Record<string, unknown>;
          i.proctorSummary = {
            ...ps,
            retake_allowed: true,
            retake_allowed_at: new Date().toISOString(),
          };
          await this.interviews.save(i);
        }
      }
    }

    return {
      success: true,
      applicationId: input.applicationId,
      action: input.action,
      integrityOverride,
    };
  }

  private async buildFilteredItems(
    filters: AssessmentReportsListFilters,
    opts: { paginate: boolean; page?: number; pageSize?: number },
  ): Promise<{ items: AssessmentReportListItem[]; total: number }> {
    const qb = this.applications
      .createQueryBuilder('a')
      .where('a.inactive = 0')
      .orderBy('a.updated_at', 'DESC');

    if (filters.jobProfileId) {
      qb.andWhere('a.job_profile_id = :jobProfileId', {
        jobProfileId: filters.jobProfileId,
      });
    }

    const apps = await qb.getMany();
    if (!apps.length) return { items: [], total: 0 };

    const candidateIds = [...new Set(apps.map((a) => String(a.candidateId)))];
    const profileIds = [...new Set(apps.map((a) => String(a.jobProfileId)))];
    const appIds = apps.map((a) => String(a.id));
    const tokens = apps.map((a) => a.candidateToken).filter((t): t is string => Boolean(t));

    const [candidates, profiles, allStages, codingRows, takeHomeRows, interviews] =
      await Promise.all([
        this.candidates.find({ where: { id: In(candidateIds), inactive: 0 } }),
        this.profiles.find({ where: { id: In(profileIds), inactive: 0 } }),
        this.stages.find({
          where: { jobProfileId: In(profileIds) },
          order: { sortOrder: 'ASC' },
        }),
        this.codingSubs.find({ where: { applicationId: In(appIds), inactive: false } }),
        Promise.resolve([] as any[]),
        tokens.length
          ? this.interviews
            .createQueryBuilder('i')
            .where('i.candidateToken IN (:...tokens)', { tokens })
            .orWhere(
              "JSON_UNQUOTE(JSON_EXTRACT(i.proctor_summary, '$.portalToken')) IN (:...tokens)",
              { tokens },
            )
            .getMany()
            .then((rows) => this.hydrateInterviewRounds(rows))
          : Promise.resolve([] as CandidateAutonomousInterviewMysql[]),
      ]);

    const overlayIds = appIds.map((id) => `app:${id}`);
    const overlays = await this.overlays.find({ where: { leadId: In(overlayIds) } });
    const overlayMap = new Map(overlays.map((o) => [o.leadId, o]));

    const candidateMap = new Map(candidates.map((c) => [String(c.id), c]));
    const profileMap = new Map(profiles.map((p) => [String(p.id), p]));
    const stagesByProfile = new Map<string, JobProfileStageMysql[]>();
    for (const s of allStages) {
      const key = String(s.jobProfileId);
      const list = stagesByProfile.get(key) ?? [];
      list.push(s);
      stagesByProfile.set(key, list);
    }
    const codingByApp = new Map<string, CodingRoundSubmissionEntity[]>();
    for (const row of codingRows) {
      const key = String(row.applicationId);
      const list = codingByApp.get(key) ?? [];
      list.push(row);
      codingByApp.set(key, list);
    }
    const takeHomeByApp = new Map<string, TakeHomeSubmissionMysql[]>();
    for (const row of takeHomeRows) {
      const key = String(row.jobApplicationId);
      const list = takeHomeByApp.get(key) ?? [];
      list.push(row);
      takeHomeByApp.set(key, list);
    }
    // Portal token → all ses_ sessions (never collapse to latest — that mixes rounds).
    const interviewsByPortal = new Map<string, CandidateAutonomousInterviewMysql[]>();
    for (const i of interviews) {
      const keys = new Set<string>();
      if (i.candidateToken) keys.add(i.candidateToken);
      const portalToken = (i.proctorSummary as Record<string, unknown> | null)?.portalToken;
      if (typeof portalToken === 'string' && portalToken) keys.add(portalToken);
      for (const key of keys) {
        const list = interviewsByPortal.get(key) ?? [];
        if (!list.some((x) => x.candidateToken === i.candidateToken)) {
          list.push(i);
        }
        interviewsByPortal.set(key, list);
      }
    }

    const [snapshotByApp, projectMetaByAppStage] = await Promise.all([
      this.roundSnapshots.listForApplications(appIds),
      this.projectInterview.getProjectMetaByAppStage(appIds),
    ]);

    let items: AssessmentReportListItem[] = [];
    for (const app of apps) {
      const candidate = candidateMap.get(String(app.candidateId));
      const profile = profileMap.get(String(app.jobProfileId));
      if (!candidate || !profile) continue;

      const profileStages = stagesByProfile.get(String(app.jobProfileId)) ?? [];
      const codingRows = codingByApp.get(String(app.id)) ?? [];
      const takeHomeForApp = takeHomeByApp.get(String(app.id)) ?? [];
      const appInterviews = app.candidateToken
        ? interviewsByPortal.get(app.candidateToken) ?? []
        : [];
      const snapshots = snapshotByApp.get(String(app.id)) ?? [];
      const reportStages = this.mergeReportStages({
        application: app,
        profileStages,
        snapshots,
        codingRows,
        takeHomeRows: takeHomeForApp,
        interviews: appInterviews,
      });
      const roundsSummary = this.buildMergedRoundsSummary({
        reportStages,
        snapshots,
        codingRows,
        takeHomeRows: takeHomeForApp,
        interviews: appInterviews,
        application: app,
        projectCombinedByAppStage: projectMetaByAppStage,
      });

      const completedScores = roundsSummary
        .filter((r) => r.scorePct != null)
        .map((r) => r.scorePct as number);
      const overallScorePct =
        completedScores.length > 0
          ? Math.round(
            (completedScores.reduce((a, b) => a + b, 0) / completedScores.length) * 10,
          ) / 10
          : null;
      const overlayForScore = overlayMap.get(`app:${app.id}`);
      const resumeScoreEarly =
        overlayForScore?.resumeMatchScore != null
          ? Number(overlayForScore.resumeMatchScore)
          : null;
      const { weightedScorePct } = computeWeightedOverallScore({
        stages: roundsSummary.map((r) => ({
          stageType: r.stageType,
          scorePct: r.scorePct,
          label: r.label,
        })),
        resumeScore: resumeScoreEarly,
      });
      const rankScore = weightedScorePct ?? overallScorePct;

      const reportStatus = this.computeReportStatus(app, roundsSummary);
      const hasDisqualification = appInterviews.some((i) => {
        const ps = (i.proctorSummary ?? {}) as Record<string, unknown>;
        const byType = (ps.by_type ?? {}) as Record<string, number>;
        const isTerminated = (byType['media_permission_terminated'] ?? 0) > 0;
        const isDisqualified =
          (isTerminated || String(i.finalDecision) === 'DISQUALIFIED') &&
          !ps.retake_allowed;
        return isDisqualified;
      });
      const overlay = overlayForScore;
      const overlayOverride = (overlay?.aiQualificationJson as Record<string, unknown> | null)?.integrityOverride as
        | { action?: string; note?: string }
        | undefined;

      let recommendation: Recommendation;
      if (hasDisqualification) {
        if (overlayOverride?.action === 'disqualify') {
          recommendation = 'disqualified';
        } else if (overlayOverride?.action === 'allow_retake') {
          recommendation = 'retake';
        } else {
          recommendation = 'flagged';
        }
      } else {
        recommendation = this.computeRecommendation({
          overallScorePct: rankScore,
          pendingHumanReview: Boolean(app.pendingHumanReview),
          applicationStatus: app.status,
          stages: roundsSummary.map((r) => ({
            stageType: r.stageType,
            status: r.status,
            scorePct: r.scorePct,
          })),
        });
      }

      const resumeScore = resumeScoreEarly;

      const evalJson = app.overallEvaluation as OverallEvaluation | null | undefined;
      const holisticScore = evalJson?.holisticScore ?? null;
      const shortlistScore = evalJson?.shortlistScore ?? computeCompositeShortlistScore({
        weightedScorePct: rankScore,
        holisticScore,
      });
      const shortlistBadge = evalJson?.shortlistBadge ?? determineShortlistBadge({
        weightedScorePct: rankScore,
        holisticScore,
        isDisqualified: hasDisqualification,
      });
      const shortlistRationale = evalJson?.shortlistRationale ?? null;

      items.push({
        applicationId: String(app.id),
        candidate: {
          id: String(candidate.id),
          name: this.candidateName(candidate),
          email: candidate.email,
          initials: this.initials(this.candidateName(candidate)),
        },
        jobProfile: {
          id: String(profile.id),
          title: profile.title,
          requisitionLabel: profile.department
            ? `${profile.slug} - ${profile.department}`
            : profile.slug,
        },
        overallScorePct: rankScore,
        shortlistScore,
        shortlistBadge,
        shortlistRationale,
        resumeScore,
        roundsSummary,
        reportStatus,
        recommendation,
        updatedAt: app.updatedAt.toISOString(),
        appliedAt: app.appliedAt.toISOString(),
      });
    }

    const q = filters.q?.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.candidate.name.toLowerCase().includes(q) ||
          i.candidate.email.toLowerCase().includes(q) ||
          i.applicationId.includes(q) ||
          i.candidate.id.includes(q),
      );
    }
    if (filters.stageType) {
      items = items.filter((i) =>
        i.roundsSummary.some((r) => r.stageType === filters.stageType),
      );
    }
    if (filters.status) {
      const statuses = filters.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        items = items.filter((i) => i.reportStatus === statuses[0]);
      } else if (statuses.length > 1) {
        items = items.filter((i) => statuses.includes(i.reportStatus));
      }
    }
    if (filters.minScore != null && !Number.isNaN(Number(filters.minScore))) {
      const min = Number(filters.minScore);
      items = items.filter(
        (i) => i.overallScorePct != null && i.overallScorePct >= min,
      );
    }
    if (filters.maxScore != null && !Number.isNaN(Number(filters.maxScore))) {
      const max = Number(filters.maxScore);
      items = items.filter(
        (i) => i.overallScorePct != null && i.overallScorePct <= max,
      );
    }
    if (filters.startDate || filters.endDate) {
      const field = filters.windowField === 'updatedAt' ? 'updatedAt' : 'appliedAt';
      const start = filters.startDate ? new Date(filters.startDate) : null;
      if (start && !Number.isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
      }
      const end = filters.endDate ? new Date(filters.endDate) : null;
      if (end && !Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
      }

      items = items.filter((i) => {
        const raw = field === 'updatedAt' ? i.updatedAt : i.appliedAt;
        const when = new Date(raw);
        if (Number.isNaN(when.getTime())) return false;
        if (start && !Number.isNaN(start.getTime()) && when < start) return false;
        if (end && !Number.isNaN(end.getTime()) && when > end) return false;
        return true;
      });
    } else if (filters.windowDays != null && Number(filters.windowDays) > 0) {
      const days = Math.min(365, Math.max(1, Math.floor(Number(filters.windowDays))));
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (days - 1));
      const field = filters.windowField === 'updatedAt' ? 'updatedAt' : 'appliedAt';
      items = items.filter((i) => {
        const raw = field === 'updatedAt' ? i.updatedAt : i.appliedAt;
        const when = new Date(raw);
        return !Number.isNaN(when.getTime()) && when >= start;
      });
    }

    const sortBy = filters.sortBy ?? 'recent';
    if (sortBy === 'score') {
      items.sort((a, b) => {
        // Prioritize composite shortlist score which integrates transcript depth
        const left = a.shortlistScore ?? a.overallScorePct ?? -1;
        const right = b.shortlistScore ?? b.overallScorePct ?? -1;
        if (right !== left) return right - left;
        // Secondary tie-breaker: pure objective score
        const leftObj = a.overallScorePct ?? -1;
        const rightObj = b.overallScorePct ?? -1;
        if (rightObj !== leftObj) return rightObj - leftObj;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    } else if (sortBy === 'name') {
      items.sort((a, b) => a.candidate.name.localeCompare(b.candidate.name));
    } else {
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    const total = items.length;
    if (opts.paginate) {
      const page = opts.page ?? 1;
      const pageSize = opts.pageSize ?? 10;
      const start = (page - 1) * pageSize;
      items = items.slice(start, start + pageSize);
    }
    return { items, total };
  }

  /**
   * Only stages assigned to this application (frozen pipeline), with attempt
   * snapshots overlaid for names/types. Never mixes in later profile rounds.
   */
  private mergeReportStages(input: {
    application: JobApplicationMysql;
    profileStages: JobProfileStageMysql[];
    snapshots: ApplicationRoundSnapshotMysql[];
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interviews: CandidateAutonomousInterviewMysql[];
  }): JobProfileStageMysql[] {
    const {
      application: app,
      profileStages,
      snapshots,
      codingRows,
      takeHomeRows,
    } = input;

    const pipeline = this.roundSnapshots.pipelineStagesForApplication(
      app,
      profileStages,
      snapshots,
    );

    if (pipeline.length) {
      return pipeline;
    }

    // Absolute fallback when no assigned/attempt snapshots yet.
    return this.selectStagesForApplication({
      stages: profileStages,
      codingRows,
      takeHomeRows,
      interviews: input.interviews,
      application: app,
    });
  }

  private stageFromSnapshot(
    snap: ApplicationRoundSnapshotMysql,
    profileStages: JobProfileStageMysql[],
  ): JobProfileStageMysql {
    const match =
      (snap.stageId
        ? profileStages.find((s) => String(s.id) === String(snap.stageId))
        : undefined) ??
      (snap.stageKey
        ? profileStages.find((s) => s.stageKey === snap.stageKey)
        : undefined);

    if (match) {
      return Object.assign(Object.create(Object.getPrototypeOf(match)), match, {
        name: snap.stageName,
        stageType: snap.stageType as JobStageType,
        sortOrder: snap.sortOrder,
      }) as JobProfileStageMysql;
    }

    return {
      id: String(snap.stageId ?? snap.id),
      jobProfileId: '0',
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
    } as unknown as JobProfileStageMysql;
  }

  private findSnapshotForStage(
    snapshots: ApplicationRoundSnapshotMysql[],
    stage: JobProfileStageMysql,
  ): ApplicationRoundSnapshotMysql | undefined {
    const sid = String(stage.id);
    const byId = snapshots.filter((s) => s.stageId && String(s.stageId) === sid);
    const matches =
      byId.length > 0
        ? byId
        : snapshots.filter(
          (s) =>
            Boolean(s.stageKey) &&
            Boolean(stage.stageKey) &&
            s.stageKey === stage.stageKey,
        );
    const attempts = matches.filter((s) => s.sourceTable !== ROUND_SOURCE.ASSIGNED);
    // Prefer LiveKit round sessions (ses_…) over portal/demo seed rows.
    // Among ses_ attempts: prefer highest scorePct so an abandoned 0% reconnect
    // does not override a real scored completion; tie-break newest createdAt.
    const sortedAttempts = [...attempts].sort(
      (a, b) => +new Date(b.createdAt).valueOf() - +new Date(a.createdAt).valueOf(),
    );
    const sesAttempts = sortedAttempts.filter((s) =>
      String(s.sourceId ?? '').startsWith('ses_'),
    );
    if (sesAttempts.length) {
      const scored = [...sesAttempts].sort((a, b) => {
        const sa = a.scorePct != null && Number.isFinite(Number(a.scorePct)) ? Number(a.scorePct) : -1;
        const sb = b.scorePct != null && Number.isFinite(Number(b.scorePct)) ? Number(b.scorePct) : -1;
        if (sb !== sa) return sb - sa;
        return +new Date(b.createdAt).valueOf() - +new Date(a.createdAt).valueOf();
      });
      return scored[0];
    }
    return sortedAttempts[0] ?? matches[0];
  }

  /**
   * Scope attempt evidence to the stage being rendered so interview/coding
   * scores do not bleed onto sibling pending verbal/coding rounds.
   * Interview sessions are resolved strictly per stage — never "latest wins".
   */
  private evidenceForStage(input: {
    stage: JobProfileStageMysql;
    snap: ApplicationRoundSnapshotMysql | undefined;
    snapshots: ApplicationRoundSnapshotMysql[];
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interviews: CandidateAutonomousInterviewMysql[];
    application: JobApplicationMysql;
  }): {
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interview: CandidateAutonomousInterviewMysql | null;
  } {
    const {
      stage,
      snap,
      snapshots,
      codingRows,
      takeHomeRows,
      interviews,
      application,
    } = input;

    let interview = this.resolveInterviewForStage(stage, snap, interviews, application);

    const frozen = (snap as { frozenInterview?: CandidateAutonomousInterviewMysql } | undefined)
      ?.frozenInterview;
    if (frozen) {
      // Use frozen interview if we have one. For AI Screening, the analyzer runs async AFTER the snapshot.
      // So we must merge the LIVE screeningVoiceAudit if it exists on the resolved session.
      interview = { ...frozen };
      if (stage.stageType === JobStageType.AI_SCREENING) {
        const live = this.resolveInterviewForStage(stage, snap, interviews, application);
        if (live?.screeningVoiceAudit) {
          interview.screeningVoiceAudit = live.screeningVoiceAudit;
        }
      }
    }

    // When snapshots exist, only attach evidence for a real attempt (not assigned placeholder).
    if (snapshots.length) {
      if (!snap || snap.sourceTable === ROUND_SOURCE.ASSIGNED) {
        return { codingRows: [], takeHomeRows: [], interview };
      }
      if (snap.sourceTable === ROUND_SOURCE.CODING) {
        return {
          codingRows: codingRows.filter(
            (c) =>
              String(c.id) === String(snap.sourceId) ||
              c.stageKey === stage.stageKey ||
              (snap.stageKey != null && c.stageKey === snap.stageKey),
          ),
          takeHomeRows: [],
          interview: null,
        };
      }
      if (snap.sourceTable === ROUND_SOURCE.TAKE_HOME) {
        return {
          codingRows: [],
          takeHomeRows: takeHomeRows.filter(
            (t) =>
              String(t.id) === String(snap.sourceId) ||
              String(t.stageId) === String(stage.id),
          ),
          interview: stage.stageType === JobStageType.PROJECT_INTERVIEW ? interview : null,
        };
      }
      if (snap.sourceTable === ROUND_SOURCE.INTERVIEW) {
        return { codingRows: [], takeHomeRows: [], interview };
      }
      return { codingRows: [], takeHomeRows: [], interview: null };
    }

    // No snapshots yet: bind by stage identity only (resolveInterviewForStage).
    return {
      codingRows: codingRows.filter((c) => c.stageKey === stage.stageKey),
      takeHomeRows: takeHomeRows.filter((t) => String(t.stageId) === String(stage.id)),
      interview,
    };
  }

  /**
   * Load every autonomous-interview session for an application portal token.
   * Each AI round creates its own ses_ row linked via proctor_summary.portalToken.
   */
  private async loadInterviewsForPortalToken(
    portalToken: string | null | undefined,
  ): Promise<CandidateAutonomousInterviewMysql[]> {
    if (!portalToken) return [];
    const rows = await this.interviews
      .createQueryBuilder('i')
      .where('i.candidateToken = :token', { token: portalToken })
      .orWhere("JSON_UNQUOTE(JSON_EXTRACT(i.proctor_summary, '$.portalToken')) = :token", {
        token: portalToken,
      })
      .orderBy('i.created_at', 'ASC')
      .getMany();
    return this.hydrateInterviewRounds(rows);
  }

  /**
   * Bind exactly one interview session to a stage. Never falls back to the
   * newest session across stages (that mixes behavioral vs technical recordings).
   *
   * Priority:
   * 1) INTERVIEW snapshot sourceId (ses_ token for that round)
   * 2) proctor_summary.stageId === this stage
   * 3) Legacy single-session only, when type/audit matches and no other stage pins exist
   *
   * Portal/demo seed rows (candidateToken === demo_/portal) are never preferred
   * when a real ses_ session exists for the stage.
   */
  private resolveInterviewForStage(
    stage: JobProfileStageMysql,
    snap: ApplicationRoundSnapshotMysql | undefined,
    interviews: CandidateAutonomousInterviewMysql[],
    app: JobApplicationMysql,
  ): CandidateAutonomousInterviewMysql | null {
    if (!interviews.length) return null;

    const byToken = new Map(interviews.map((i) => [i.candidateToken, i]));
    const stageId = String(stage.id);
    const portalToken = app.candidateToken ?? '';

    const isPortalSeed = (i: CandidateAutonomousInterviewMysql) => {
      const t = String(i.candidateToken ?? '');
      return (
        t === portalToken ||
        t.startsWith('demo_') ||
        (!t.startsWith('ses_') &&
          !(i.proctorSummary as Record<string, unknown> | null)?.stageId)
      );
    };

    const preferSes = (pool: CandidateAutonomousInterviewMysql[]) => {
      const ses = pool.filter((i) => String(i.candidateToken ?? '').startsWith('ses_'));
      const use = ses.length ? ses : pool.filter((i) => !isPortalSeed(i));
      const finalPool = use.length ? use : pool;
      // Prefer sessions that actually have audit/chat/recording over empty restarts.
      return (
        [...finalPool].sort((a, b) => {
          const scoreDiff =
            this.sessionContentScore(b, stage.stageType) -
            this.sessionContentScore(a, stage.stageType);
          if (scoreDiff !== 0) return scoreDiff;
          return +new Date(b.createdAt).valueOf() - +new Date(a.createdAt).valueOf();
        })[0] ?? null
      );
    };

    if (snap?.sourceTable === ROUND_SOURCE.INTERVIEW && snap.sourceId) {
      const sourceId = String(snap.sourceId);
      const hit = byToken.get(sourceId);
      // Only trust snapshot source when it is a LiveKit session (or the only row).
      if (hit && sourceId.startsWith('ses_')) {
        // If this ses_ is an empty restart, prefer a richer ses_ pinned to the same stage.
        const pinned = interviews.filter((i) => {
          const ps = (i.proctorSummary as Record<string, unknown> | null) ?? {};
          return ps.stageId != null && String(ps.stageId) === stageId;
        });
        if (pinned.length) {
          const best = preferSes(pinned);
          if (
            best &&
            this.sessionContentScore(best, stage.stageType) >
            this.sessionContentScore(hit, stage.stageType)
          ) {
            return best;
          }
        }
        if (this.sessionContentScore(hit, stage.stageType) > 0) return hit;
        // Empty snapshot target — fall through to stageId pin.
      } else if (hit && !isPortalSeed(hit) && this.sessionContentScore(hit, stage.stageType) > 0) {
        return hit;
      }
      // demo_/portal source_id is a seed shell — fall through to stageId pin.
    }

    const pinnedToStage = interviews.filter((i) => {
      const ps = (i.proctorSummary as Record<string, unknown> | null) ?? {};
      return ps.stageId != null && String(ps.stageId) === stageId;
    });
    if (pinnedToStage.length) {
      return preferSes(pinnedToStage);
    }

    // Another session is pinned to a different stage → this stage has no match yet
    // (ignore portal seed rows without stageId — they are not real round pins).
    const hasForeignPin = interviews.some((i) => {
      if (isPortalSeed(i)) return false;
      const ps = (i.proctorSummary as Record<string, unknown> | null) ?? {};
      return ps.stageId != null && String(ps.stageId) !== stageId;
    });
    if (hasForeignPin) return null;

    // Legacy: one attempted session (or one in-progress), must map to this stage.
    const nonSeed = interviews.filter((i) => !isPortalSeed(i));
    const poolBase = nonSeed.length ? nonSeed : interviews;
    const attempted = poolBase.filter((i) => this.interviewHasAttempt(i));
    const pool = attempted.length ? attempted : poolBase;
    if (pool.length !== 1) return null;

    const only = pool[0];
    const picked = this.pickVerbalStageForInterview([stage], app, only);
    if (picked && String(picked.id) === stageId) return only;
    if (this.interviewBelongsToStageType(only, stage.stageType)) return only;
    return null;
  }

  /**
   * Rank how much reportable content a session has. Used so empty restarts
   * (phase set / recording started) do not hide a completed behavioural ses_.
   */
  private sessionContentScore(
    interview: CandidateAutonomousInterviewMysql,
    stageType?: JobStageType | string,
  ): number {
    let score = 0;
    const hr = interview.hrVoiceAudit != null;
    const tech = interview.stage1VoiceAudit != null;
    const screening = interview.screeningVoiceAudit != null;
    if (hr) score += 100;
    if (tech) score += 100;
    if (screening) score += 80;
    const stage3 = interview.stage3ChatHistory;
    if (Array.isArray(stage3) && stage3.length > 0) score += 40;
    const stage1 = interview.stage1ChatHistory;
    if (Array.isArray(stage1) && stage1.length > 0) score += 40;
    if (interview.recordingUrl) score += 20;
    const ps = interview.proctorSummary as Record<string, unknown> | null;
    if (ps) {
      const byType = (ps.by_type ?? {}) as Record<string, number>;
      if ((byType['media_permission_terminated'] ?? 0) > 0) score += 90;
      if (Number(ps.total_events ?? 0) > 0) score += 30;
      if (Number(ps.critical_count ?? 0) > 0) score += 30;
    }
    if (String(interview.finalDecision) === 'DISQUALIFIED') score += 50;
    if (stageType === JobStageType.HR_VERBAL || stageType === 'hr_verbal') {
      if (hr) score += 50;
      if (Array.isArray(stage3) && stage3.length > 0) score += 20;
    }
    if (
      stageType === JobStageType.AI_VERBAL ||
      stageType === JobStageType.SCREENING ||
      stageType === JobStageType.PROJECT_INTERVIEW ||
      stageType === 'ai_verbal'
    ) {
      if (tech) score += 50;
    }
    if (stageType === JobStageType.AI_SCREENING && screening) score += 50;
    return score;
  }

  /** Soft type check for legacy single-session rows without proctor stageId. */
  private interviewBelongsToStageType(
    interview: CandidateAutonomousInterviewMysql,
    stageType: JobStageType | string,
  ): boolean {
    const ps = (interview.proctorSummary as Record<string, unknown> | null) ?? {};
    if (ps.stageType != null && String(ps.stageType) === String(stageType)) return true;
    if (ps.isBehavioral && stageType === JobStageType.HR_VERBAL) return true;

    const hasScreening = interview.screeningVoiceAudit != null;
    const hasHr = interview.hrVoiceAudit != null;
    const hasTech = interview.stage1VoiceAudit != null;
    const phase = String(interview.currentPhase ?? '');

    if (stageType === JobStageType.AI_SCREENING) {
      return (
        hasScreening ||
        phase === AutonomousInterviewPhase.AI_SCREENING ||
        phase === 'ai_screening'
      );
    }
    if (stageType === JobStageType.HR_VERBAL) {
      return (
        hasHr ||
        !!ps.isBehavioral ||
        phase === AutonomousInterviewPhase.HR_VERBAL ||
        phase === 'hr_verbal'
      );
    }
    if (
      stageType === JobStageType.AI_VERBAL ||
      stageType === JobStageType.SCREENING
    ) {
      if (hasHr && !hasTech) return false;
      if (hasScreening && !hasTech) return false;
      return (
        hasTech ||
        phase === AutonomousInterviewPhase.INTRO_VERBAL ||
        phase === 'intro_verbal' ||
        phase === 'completed'
      );
    }
    return false;
  }

  private buildMergedRoundsSummary(input: {
    reportStages: JobProfileStageMysql[];
    snapshots: ApplicationRoundSnapshotMysql[];
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interviews: CandidateAutonomousInterviewMysql[];
    application: JobApplicationMysql;
    /** Live Build & Defend finals and status — overrides verbal-only snapshot/list scores. */
    projectCombinedByAppStage?: Map<string, ProjectStageMeta | number>;
  }): RoundSummaryItem[] {
    const {
      reportStages,
      snapshots,
      codingRows,
      takeHomeRows,
      interviews,
      application: app,
      projectCombinedByAppStage,
    } = input;

    const items = reportStages.map((stage) => {
      const snap = this.findSnapshotForStage(snapshots, stage);
      if (snap && snap.sourceTable !== ROUND_SOURCE.ASSIGNED) {
        return this.applyProjectCombinedScore(
          {
            stageId: String(stage.id),
            stageType: snap.stageType,
            label: snap.stageName,
            scorePct: snap.scorePct != null ? Number(snap.scorePct) : null,
            status: this.snapshotStatus(snap),
          },
          app,
          stage,
          projectCombinedByAppStage,
        );
      }
      if (snap && snap.sourceTable === ROUND_SOURCE.ASSIGNED) {
        // Prefer live attempt evidence over the assigned "pending" shell when the
        // candidate has already sat this stage (snapshot upsert may lag analyzer).
        const scoped = this.evidenceForStage({
          stage,
          snap,
          snapshots,
          codingRows,
          takeHomeRows,
          interviews,
          application: app,
        });
        if (scoped.interview || scoped.codingRows.length || scoped.takeHomeRows.length) {
          const [item] = this.buildRoundsSummary({
            stages: [stage],
            codingRows: scoped.codingRows,
            takeHomeRows: scoped.takeHomeRows,
            interview: scoped.interview,
            applicationId: String(app.id),
            projectCombinedByAppStage,
          });
          if (item) {
            return {
              ...item,
              label: snap.stageName || item.label,
              stageType: snap.stageType || item.stageType,
            };
          }
        }
        return this.applyProjectCombinedScore(
          {
            stageId: String(stage.id),
            stageType: snap.stageType,
            label: snap.stageName,
            scorePct: null,
            status: 'pending' as StageEvalStatus,
          },
          app,
          stage,
          projectCombinedByAppStage,
        );
      }
      // Pending (or unscored) stage from apply-time pipeline — no score bleed.
      const scoped = this.evidenceForStage({
        stage,
        snap: undefined,
        snapshots,
        codingRows,
        takeHomeRows,
        interviews,
        application: app,
      });
      const [item] = this.buildRoundsSummary({
        stages: [stage],
        codingRows: scoped.codingRows,
        takeHomeRows: scoped.takeHomeRows,
        interview: scoped.interview,
        applicationId: String(app.id),
        projectCombinedByAppStage,
      });
      return (
        item ?? {
          stageId: String(stage.id),
          stageType: stage.stageType,
          label: this.stageLabel(stage),
          scorePct: null,
          status: 'pending' as StageEvalStatus,
        }
      );
    });
    return items.map((item, index) => ({
      ...item,
      endedByCandidate: this.stageEndedByCandidate(
        String(reportStages[index]?.id ?? item.stageId),
        interviews,
      ),
    }));
  }

  private stageEndedByCandidate(
    stageId: string,
    interviews: CandidateAutonomousInterviewMysql[],
  ): boolean {
    return interviews.some((interview) => {
      const ps = (interview.proctorSummary as Record<string, unknown> | null) ?? {};
      if (ps.stageId == null || String(ps.stageId) !== stageId) return false;
      if (ps.bndPhase === 'build') return false;
      return this.candidateEndedInterview(interview);
    });
  }

  private candidateEndedInterview(
    interview: CandidateAutonomousInterviewMysql | null | undefined,
  ): boolean {
    if (!interview) return false;
    const ps = (interview.proctorSummary as Record<string, unknown> | null) ?? {};
    if (ps.bndPhase === 'build') return false;
    if (ps.terminated_by === 'candidate') return true;
    const byType = (ps.by_type ?? {}) as Record<string, number>;
    return (byType.candidate_ended_interview ?? 0) > 0;
  }

  /**
   * Live Build & Defend submission wins over a snapshot.
   * READY_FOR_INTERVIEW is still in progress until the Defend session itself completes.
   * The Build session is marked completed earlier, when the candidate submits code.
   */
  private liveProjectStatus(fallback: StageEvalStatus, meta: ProjectStageMeta): StageEvalStatus {
    switch (meta.status) {
      case ProjectInterviewStatus.IN_BUILD:
        return 'in_progress';
      case ProjectInterviewStatus.EVALUATING_CODE:
        return 'evaluating';
      case ProjectInterviewStatus.READY_FOR_INTERVIEW:
        return meta.defendCompleted ? 'completed' : 'in_progress';
      case ProjectInterviewStatus.PENDING_SUBMISSION:
        return meta.selectedProjectId ? 'in_progress' : 'pending';
      case ProjectInterviewStatus.COMPLETED:
        return 'completed';
      case ProjectInterviewStatus.EXPIRED:
        return 'failed';
      default:
        return fallback;
    }
  }

  /** Prefer final code+verbal Build & Defend mix and live status over verbal-only list/snapshot scores. */
  private applyProjectCombinedScore(
    item: RoundSummaryItem,
    app: JobApplicationMysql,
    stage: JobProfileStageMysql,
    projectCombinedByAppStage?: Map<string, ProjectStageMeta | number>,
  ): RoundSummaryItem {
    const stageType = item.stageType || stage.stageType;
    if (stageType !== JobStageType.PROJECT_INTERVIEW || !projectCombinedByAppStage) {
      return item;
    }
    const raw = projectCombinedByAppStage.get(`${app.id}:${stage.id}`);
    if (raw == null) return item;
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? { ...item, scorePct: raw } : item;
    }

    const meta = raw as ProjectStageMeta;
    const status = this.liveProjectStatus(item.status, meta);

    return {
      ...item,
      scorePct:
        meta.scorePct != null && Number.isFinite(meta.scorePct)
          ? meta.scorePct
          : item.scorePct,
      status,
    };
  }

  /**
   * Build stage shells from frozen snapshots so reports show attempt-time names.
   */
  private stagesFromSnapshots(
    snapshots: ApplicationRoundSnapshotMysql[],
    profileStages: JobProfileStageMysql[],
  ): JobProfileStageMysql[] {
    return snapshots.map((snap) => this.stageFromSnapshot(snap, profileStages));
  }

  private roundsSummaryFromSnapshots(
    snapshots: ApplicationRoundSnapshotMysql[],
  ): RoundSummaryItem[] {
    return snapshots.map((snap) => ({
      stageId: String(snap.stageId ?? snap.id),
      stageType: snap.stageType,
      label: snap.stageName,
      scorePct: snap.scorePct != null ? Number(snap.scorePct) : null,
      status: this.snapshotStatus(snap),
    }));
  }

  private snapshotStatus(snap: ApplicationRoundSnapshotMysql): StageEvalStatus {
    const s = String(snap.status ?? '').toLowerCase();
    if (['submitted', 'graded', 'completed', 'auto_pass_to_offer'].includes(s)) {
      return 'completed';
    }
    if (['in_review', 'under_review'].includes(s)) return 'in_review';
    if (['grading', 'evaluating', 'evaluating_code'].includes(s)) return 'evaluating';
    if (
      [
        'in_progress',
        'assigned',
        'intro_verbal',
        'hr_verbal',
        'sandbox_code',
        'closing',
        'bnd_assessment',
        'bnd_interview',
        'in_build',
        'ready_for_interview',
      ].includes(s)
    ) {
      return 'in_progress';
    }
    if (['failed', 'error', 'expired', 'auto_reject'].includes(s)) return 'failed';
    if (s === 'pending' || s === 'not_started') return 'pending';
    if (snap.scorePct != null) return 'completed';
    return 'pending';
  }

  /**
   * Build the report stage list from what this candidate actually attempted.
   * Soft-deleted (inactive) historical stages are preferred over newly added
   * live profile stages the candidate never sat.
   */
  private selectStagesForApplication(input: {
    stages: JobProfileStageMysql[];
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interviews: CandidateAutonomousInterviewMysql[];
    application: JobApplicationMysql;
  }): JobProfileStageMysql[] {
    const { stages, codingRows, takeHomeRows, interviews, application: app } = input;
    const selected = new Map<string, JobProfileStageMysql>();

    const preferStage = (stage: JobProfileStageMysql | undefined) => {
      if (!stage) return;
      const key = String(stage.id);
      const existing = selected.get(key);
      if (!existing) {
        selected.set(key, stage);
        return;
      }
      // Prefer the historical (inactive) row when both somehow collide.
      if (existing.inactive === 0 && stage.inactive !== 0) {
        selected.set(key, stage);
      }
    };

    for (const row of codingRows) {
      const matches = stages.filter((s) => s.stageKey === row.stageKey);
      // Prefer inactive historical stage for this key if present, else live.
      const historical = matches.find((s) => s.inactive !== 0);
      const live = matches.find((s) => s.inactive === 0);
      preferStage(historical ?? live ?? matches[0]);
    }

    for (const row of takeHomeRows) {
      preferStage(stages.find((s) => String(s.id) === String(row.stageId)));
    }

    // Only attach interview when there is real attempt evidence (not an empty
    // row created at application start). Map each session to its own stage.
    for (const interview of interviews) {
      if (this.interviewHasAttempt(interview)) {
        preferStage(this.pickVerbalStageForInterview(stages, app, interview));
      }
    }

    // Do not inject live currentStageId ΓÇö that reintroduces newly configured rounds.

    return [...selected.values()].sort(
      (a, b) => Number(a.sortOrder) - Number(b.sortOrder) || Number(a.id) - Number(b.id),
    );
  }

  /** True when the candidate actually progressed in autonomous interview. */
  private interviewHasAttempt(
    interview: CandidateAutonomousInterviewMysql,
  ): boolean {
    if (String(interview.finalDecision) === 'DISQUALIFIED') return true;
    const ps = interview.proctorSummary as Record<string, unknown> | null;
    if (ps) {
      const byType = (ps.by_type ?? {}) as Record<string, number>;
      if ((byType['media_permission_terminated'] ?? 0) > 0) return true;
      if (Number(ps.total_events ?? 0) > 0) return true;
      if (Number(ps.critical_count ?? 0) > 0) return true;
      if (Number(ps.fraud_risk_score ?? 0) > 0) return true;
    }
    const voice = Number(interview.stage1VoiceScore ?? 0);
    if (voice > 0) return true;
    if (interview.codeQualityScore != null) return true;
    if (interview.stage1VoiceAudit) return true;
    if (interview.screeningVoiceAudit) return true;
    if (interview.hrVoiceAudit) return true;
    if (interview.recordingUrl) return true;
    const stage3 = interview.stage3ChatHistory;
    if (Array.isArray(stage3) && stage3.length > 0) return true;
    if (stage3 && typeof stage3 === 'object' && !Array.isArray(stage3) && Object.keys(stage3).length > 0) {
      return true;
    }
    const chat = interview.stage1ChatHistory;
    if (Array.isArray(chat) && chat.length > 0) return true;
    if (chat && typeof chat === 'object' && !Array.isArray(chat) && Object.keys(chat).length > 0) {
      return true;
    }
    const phase = String(interview.currentPhase ?? '');
    if (
      phase &&
      phase !== AutonomousInterviewPhase.INTRO_VERBAL &&
      phase !== 'intro_verbal'
    ) {
      return true;
    }
    return false;
  }

  /**
   * Map autonomous interview ΓåÆ stage the candidate sat.
   * Prefer ai_verbal / hr_verbal; do not default to a later-added screening "Verbal".
   */
  private pickVerbalStageForInterview(
    stages: JobProfileStageMysql[],
    app: JobApplicationMysql,
    interview: CandidateAutonomousInterviewMysql,
  ): JobProfileStageMysql | undefined {
    const verbal = stages
      .filter((s) => this.isVerbalStageType(s.stageType))
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    if (!verbal.length) return undefined;

    // Prefer the stage frozen onto the session at Start Round (survives COMPLETED phase).
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
    if (current && this.isVerbalStageType(current.stageType)) {
      if (current.stageType === JobStageType.AI_SCREENING && (hasScreening || (!hasHr && !hasTech))) {
        return current;
      }
      if (current.stageType === JobStageType.HR_VERBAL && hasHr) return current;
      if (current.stageType === JobStageType.AI_VERBAL && hasTech) return current;
    }

    const phase = String(interview.currentPhase ?? '');
    // After completion, phase is "completed" — infer from audit payloads, not phase alone.
    const preferredTypes: JobStageType[] = hasScreening
      ? [JobStageType.AI_SCREENING, JobStageType.AI_VERBAL, JobStageType.HR_VERBAL]
      : hasHr || phase === AutonomousInterviewPhase.HR_VERBAL || phase === 'hr_verbal'
        ? [JobStageType.HR_VERBAL, JobStageType.AI_VERBAL, JobStageType.AI_SCREENING]
        : phase === AutonomousInterviewPhase.AI_SCREENING || phase === 'ai_screening'
          ? [JobStageType.AI_SCREENING, JobStageType.AI_VERBAL, JobStageType.HR_VERBAL]
          : [JobStageType.AI_VERBAL, JobStageType.AI_SCREENING, JobStageType.HR_VERBAL];

    const pickByTypes = (pool: JobProfileStageMysql[]) => {
      for (const type of preferredTypes) {
        const matches = pool.filter((s) => s.stageType === type);
        if (matches.length) return matches[matches.length - 1];
      }
      return undefined;
    };

    const historical = verbal.filter((s) => s.inactive !== 0);
    const fromHistorical = pickByTypes(historical);
    if (fromHistorical) return fromHistorical;

    const live = verbal.filter((s) => s.inactive === 0);
    const fromLive = pickByTypes(live);
    if (fromLive) return fromLive;

    // Screening only if no AI/HR verbal stage exists on the profile at all.
    return (
      historical.find((s) => s.stageType === JobStageType.SCREENING) ??
      live.find((s) => s.stageType === JobStageType.SCREENING)
    );
  }

  private isVerbalStageType(stageType: JobStageType | string): boolean {
    return (
      stageType === JobStageType.SCREENING ||
      stageType === JobStageType.AI_SCREENING ||
      stageType === JobStageType.AI_VERBAL ||
      stageType === JobStageType.HR_VERBAL ||
      stageType === JobStageType.PROJECT_INTERVIEW
    );
  }

  private buildRoundsSummary(input: {
    stages: JobProfileStageMysql[];
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interview: CandidateAutonomousInterviewMysql | null;
    applicationId?: string;
    projectCombinedByAppStage?: Map<string, ProjectStageMeta | number>;
  }): RoundSummaryItem[] {
    return input.stages.map((stage) => {
      // Submission type wins over later profile renames (e.g. take-home stage
      // renamed to "Verbal" / screening after the candidate submitted).
      const takeHomeRow = input.takeHomeRows.find(
        (t) => String(t.stageId) === String(stage.id),
      );
      if (takeHomeRow || stage.stageType === JobStageType.TAKE_HOME) {
        const row =
          takeHomeRow ??
          input.takeHomeRows.find((t) => String(t.stageId) === String(stage.id));
        return {
          stageId: String(stage.id),
          stageType: JobStageType.TAKE_HOME,
          label: this.takeHomeLabel(stage),
          scorePct: row?.score != null ? Number(row.score) : null,
          status: this.takeHomeStatus(row),
        };
      }

      const label = this.stageLabel(stage);
      if (stage.stageType === JobStageType.CODING) {
        const row = input.codingRows.find((c) => c.stageKey === stage.stageKey);
        return {
          stageId: String(stage.id),
          stageType: stage.stageType,
          label,
          scorePct: row?.scorePct != null ? Number(row.scorePct) : null,
          status: this.codingStatus(row),
        };
      }
      if (stage.stageType === JobStageType.AI_SCREENING) {
        const audit =
          input.interview?.screeningVoiceAudit &&
            typeof input.interview.screeningVoiceAudit === 'object'
            ? (input.interview.screeningVoiceAudit as Record<string, unknown>)
            : null;
        const analyzerStatus = String(audit?.analyzerStatus ?? '');
        let status: StageEvalStatus = 'pending';
        if (analyzerStatus === 'COMPLETED') status = 'completed';
        else if (analyzerStatus === 'FAILED') status = 'failed';
        else if (audit) status = 'evaluating';
        return {
          stageId: String(stage.id),
          stageType: stage.stageType,
          label,
          scorePct: null,
          status,
        };
      }
      if (
        stage.stageType === JobStageType.SCREENING ||
        stage.stageType === JobStageType.AI_VERBAL ||
        stage.stageType === JobStageType.HR_VERBAL ||
        stage.stageType === JobStageType.PROJECT_INTERVIEW
      ) {
        const interview =
          input.interview && this.interviewHasAttempt(input.interview)
            ? input.interview
            : null;
        let verbalPct = this.verbalScorePct(stage.stageType, interview);
        let status = this.verbalStatusForStage(stage.stageType, interview);
        if (stage.stageType === JobStageType.PROJECT_INTERVIEW && input.applicationId) {
          const raw = input.projectCombinedByAppStage?.get(`${input.applicationId}:${stage.id}`);
          if (raw != null) {
            if (typeof raw === 'number') {
              if (Number.isFinite(raw)) verbalPct = raw;
            } else {
              const meta = raw as ProjectStageMeta;
              if (meta.scorePct != null && Number.isFinite(meta.scorePct)) {
                verbalPct = meta.scorePct;
              }
              status = this.liveProjectStatus(status, meta);
            }
          }
        }
        return {
          stageId: String(stage.id),
          stageType: stage.stageType,
          label,
          scorePct: verbalPct,
          status,
        };
      }
      return {
        stageId: String(stage.id),
        stageType: stage.stageType,
        label,
        scorePct: null,
        status: 'pending' as StageEvalStatus,
      };
    });
  }

  private takeHomeLabel(stage: JobProfileStageMysql): string {
    if (
      stage.stageType === JobStageType.TAKE_HOME &&
      stage.name?.trim()
    ) {
      return stage.name.trim();
    }
    return 'Take-home';
  }

  private async buildStageReport(input: {
    stage: JobProfileStageMysql;
    codingRows: CodingRoundSubmissionEntity[];
    takeHomeRows: TakeHomeSubmissionMysql[];
    interview: CandidateAutonomousInterviewMysql | null;
    candidateToken: string | null;
    applicationId?: string;
    problemMap: Map<string, ProblemBankProblemMysql>;
  }): Promise<AssessmentStageReport> {
    const { stage } = input;
    const hasTakeHome = input.takeHomeRows.some(
      (t) => String(t.stageId) === String(stage.id),
    );
    if (hasTakeHome || stage.stageType === JobStageType.TAKE_HOME) {
      return this.buildTakeHomeStage(stage, input.takeHomeRows);
    }
    if (stage.stageType === JobStageType.CODING) {
      return this.buildCodingStage(stage, input.codingRows, input.problemMap);
    }
    if (stage.stageType === JobStageType.AI_SCREENING) {
      const report = this.buildAiScreeningStage(stage, input.interview);
      report.recordingUrl = await toRecordingPlaybackUrl(report.recordingUrl);
      return report;
    }
    if (
      stage.stageType === JobStageType.SCREENING ||
      stage.stageType === JobStageType.AI_VERBAL ||
      stage.stageType === JobStageType.HR_VERBAL ||
      stage.stageType === JobStageType.PROJECT_INTERVIEW
    ) {
      const interview =
        input.interview && this.interviewHasAttempt(input.interview)
          ? input.interview
          : null;
      const report = this.buildVerbalStage(stage, interview);
      if (stage.stageType === JobStageType.PROJECT_INTERVIEW && input.applicationId) {
        report.project = await this.projectInterview.getReportSummary(
          input.applicationId,
          String(stage.id),
        );
        if (report.project?.final_combined_score_pct != null) {
          report.scorePct = report.project.final_combined_score_pct;
        }
        if (report.project?.duration_minutes != null) {
          report.durationMinutes = report.project.duration_minutes;
        }
        if (report.project?.status) {
          switch (report.project.status) {
            case ProjectInterviewStatus.COMPLETED:
              report.status = 'completed';
              break;
            case ProjectInterviewStatus.EVALUATING_CODE:
              report.status = 'evaluating';
              break;
            case ProjectInterviewStatus.IN_BUILD:
              report.status = 'in_progress';
              break;
            case ProjectInterviewStatus.READY_FOR_INTERVIEW:
              report.status = 'in_progress';
              break;
            case ProjectInterviewStatus.PENDING_SUBMISSION:
              report.status = report.project.project_id ? 'in_progress' : 'pending';
              break;
            case ProjectInterviewStatus.EXPIRED:
              report.status = 'failed';
              break;
          }
        }
        const defendToken = report.project?.interview_token;
        let defendInterview =
          defendToken && interview?.candidateToken === defendToken ? interview : null;
        if (defendToken) {
          report.interviewReportPath = `/assessments/interview-reports/${encodeURIComponent(defendToken)}`;
          if (!defendInterview) {
            defendInterview = await this.interviews.findOne({ where: { candidateToken: defendToken } });
          }
          if (
            report.project?.status === ProjectInterviewStatus.READY_FOR_INTERVIEW &&
            defendInterview?.currentPhase === AutonomousInterviewPhase.COMPLETED
          ) {
            report.status = 'completed';
          }
          if (this.candidateEndedInterview(defendInterview)) {
            report.endedByCandidate = true;
          }
          if (defendInterview) {
            const ps = (defendInterview.proctorSummary ?? {}) as Record<string, unknown>;
            const byType = (ps.by_type ?? {}) as Record<string, number>;
            const isTerminated = (byType['media_permission_terminated'] ?? 0) > 0;
            const isDisqualified =
              (isTerminated || String(defendInterview.finalDecision) === 'DISQUALIFIED') &&
              !ps.retake_allowed;
            if (isDisqualified) {
              report.integrityDisqualification = {
                disqualified: true,
                reason: isTerminated ? 'Proctoring integrity violation' : 'Integrity risk detected',
                details: isTerminated
                  ? 'The interview session was terminated early after excessive camera or microphone interruptions.'
                  : 'Suspicious proctoring activity was detected during the interview defense.',
                stageName: this.stageLabel(stage),
                stageId: String(stage.id),
                sessionToken: defendToken,
                eventTime: ps.last_event_at ? String(ps.last_event_at) : undefined,
                fraudRiskScore: Number(ps.fraud_risk_score ?? 0),
                criticalCount: Number(ps.critical_count ?? 0),
                totalEvents: Number(ps.total_events ?? 0),
              };
            }
          }
        }
        if (!report.competencies.some((c) => c.key === 'defend_interview')) {
          const defendNote = report.integrityDisqualification?.disqualified
            ? 'Terminated early — proctoring integrity violation'
            : report.project?.verbal_defend_score_pct != null
              ? 'Verbal defense completed'
              : 'Defend interview not completed';
          report.competencies.push({
            key: 'defend_interview',
            label: `Verbal Defense (${report.project?.scoring_weights?.interview_performance ?? 50}%)`,
            scorePct: report.project?.verbal_defend_score_pct ?? null,
            note: defendNote,
          });
        }
        // Prefer Build & Defend formula — do not reuse take-home "Interview/Coding" justification.
        const bndJustification = this.projectInterviewScoreJustification(report.project);
        if (bndJustification) {
          report.aiEvaluation = {
            ...(report.aiEvaluation ?? { status: 'unavailable', strengths: [], improvements: [] }),
            scoreJustification: bndJustification,
            meta: {
              ...(report.aiEvaluation?.meta && typeof report.aiEvaluation.meta === 'object'
                ? report.aiEvaluation.meta
                : {}),
              codeBuildScorePct: report.project?.code_build_score_pct ?? null,
              verbalDefendScorePct: report.project?.verbal_defend_score_pct ?? null,
              finalCombinedScorePct: report.project?.final_combined_score_pct ?? null,
              codeWeightPct: report.project?.scoring_weights?.code_submission ?? null,
              interviewWeightPct: report.project?.scoring_weights?.interview_performance ?? null,
            },
          };
        }
      }
      if (stage.stageType === JobStageType.AI_VERBAL) {
        const urls = (
          interview as CandidateAutonomousInterviewMysql & {
            roundMergedUrls?: Partial<Record<AutonomousInterviewRoundType, string | null>>;
          } | null
        )?.roundMergedUrls;
        report.recordingUrl = await toRecordingPlaybackUrl(
          urls?.[AutonomousInterviewRoundType.INTRO_VERBAL] ?? null,
        );
      }
      return report;
    }
    const generic: GenericStageReport = {
      stageType: stage.stageType,
      stageId: String(stage.id),
      label: this.stageLabel(stage),
      status: 'pending',
      scorePct: null,
      aiEvaluation: { status: 'unavailable', strengths: [], improvements: [] },
      rawAiPayload: null,
    };
    return generic;
  }

  private buildCodingStage(
    stage: JobProfileStageMysql,
    codingRows: CodingRoundSubmissionEntity[],
    problemMap: Map<string, ProblemBankProblemMysql>,
  ): CodingStageReport {
    const row = codingRows.find((c) => c.stageKey === stage.stageKey) ?? null;
    const submissions = (row?.problemSubmissions ?? {}) as Record<
      string,
      ProblemSubmissionLike
    >;
    const ids =
      row?.assignedProblemIds?.length
        ? row.assignedProblemIds.map(String)
        : Object.keys(submissions);

    const questions: CodingQuestionReport[] = ids.map((problemId) => {
      const sub = submissions[problemId] ?? {};
      const problem = problemMap.get(String(problemId));
      const tests = Array.isArray(sub.testResults) ? sub.testResults : [];
      const testsPassed = tests.length
        ? tests.filter((t) => t.passed).length
        : null;
      const testsTotal = tests.length || null;
      const runtimes = tests
        .map((t) => t.time_ms ?? t.timeMs)
        .filter((n): n is number => typeof n === 'number');
      const runtimeMs =
        sub.runtimeMs ??
        (runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : null);
      const aiFeedback = sub.aiFeedback;
      const status: NormalizedAiEvaluation['status'] =
        row?.status === 'grading'
          ? 'evaluating'
          : aiFeedback
            ? 'ready'
            : row?.status === 'submitted'
              ? 'pending'
              : 'unavailable';

      return {
        problemId: String(problemId),
        title: problem?.title ?? `Problem ${problemId}`,
        difficulty: problem?.difficulty ?? null,
        language: sub.language ?? null,
        testsPassed,
        testsTotal,
        runtimeMs,
        memoryMb: sub.memoryMb ?? null,
        scorePct: sub.scorePct != null ? Number(sub.scorePct) : null,
        aiEvaluation: this.normalizeCodingAi(aiFeedback, status),
        rawAiPayload: {
          aiFeedback: aiFeedback ?? null,
          testResults: sub.testResults ?? null,
          scorePct: sub.scorePct ?? null,
        },
      };
    });

    const questionsPassed = questions.filter(
      (q) =>
        q.testsTotal != null &&
        q.testsPassed != null &&
        q.testsPassed === q.testsTotal,
    ).length;

    let durationMinutes: number | null = null;
    if (row?.createdAt && row?.submittedAt) {
      durationMinutes = Math.max(
        1,
        Math.round((row.submittedAt.getTime() - row.createdAt.getTime()) / 60000),
      );
    }

    return {
      stageType: 'coding',
      stageId: String(stage.id),
      label: this.stageLabel(stage),
      status: this.codingStatus(row),
      scorePct: row?.scorePct != null ? Number(row.scorePct) : null,
      questionsPassed: questions.length ? questionsPassed : null,
      questionsTotal: questions.length || null,
      durationMinutes,
      runtimeEnv: null,
      questions,
    };
  }

  private async buildTakeHomeStage(
    stage: JobProfileStageMysql,
    takeHomeRows: TakeHomeSubmissionMysql[],
  ): Promise<TakeHomeStageReport> {
    const row = takeHomeRows.find((t) => String(t.stageId) === String(stage.id)) ?? null;
    const evalRuns: any[] = [];

    const criteria = Array.isArray(row?.criteriaResultsJson)
      ? row!.criteriaResultsJson.map((c) => {
        const item = c as Record<string, unknown>;
        return {
          id: String(item.id ?? item.label ?? 'criterion'),
          label: String(item.label ?? item.id ?? 'Criterion'),
          score: typeof item.score === 'number' ? item.score : null,
          max: typeof item.max === 'number' ? item.max : null,
          passed: typeof item.passed === 'boolean' ? item.passed : undefined,
          feedback: typeof item.feedback === 'string' ? item.feedback : undefined,
        };
      })
      : [];

    const scoresBreakdown =
      row?.scoresJson && typeof row.scoresJson === 'object'
        ? {
          accuracy:
            typeof row.scoresJson.accuracy === 'number'
              ? row.scoresJson.accuracy
              : undefined,
          code_quality:
            typeof row.scoresJson.code_quality === 'number'
              ? row.scoresJson.code_quality
              : undefined,
          originality:
            typeof row.scoresJson.originality === 'number'
              ? row.scoresJson.originality
              : undefined,
        }
        : null;

    const status = this.takeHomeStatus(row);
    const evalStatus =
      status === 'evaluating'
        ? 'evaluating'
        : status === 'completed'
          ? 'ready'
          : status === 'pending' || status === 'in_progress'
            ? 'pending'
            : 'unavailable';

    const feedbackBits = criteria
      .map((c) => c.feedback)
      .filter((f): f is string => Boolean(f));

    let durationMinutes: number | null = null;
    if (row?.createdAt && row?.submittedAt) {
      const diffMs = row.submittedAt.getTime() - row.createdAt.getTime();
      if (diffMs > 0) {
        durationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
    }

    return {
      stageType: 'take_home',
      stageId: String(stage.id),
      label: this.takeHomeLabel(stage),
      status,
      scorePct: row?.score != null ? Number(row.score) : null,
      durationMinutes,
      subtitle: row?.githubUrl
        ? 'GitHub repo submitted'
        : row?.artifactType
          ? `${row.artifactType} submitted`
          : null,
      artifacts: {
        type: row?.artifactType ?? null,
        githubUrl: row?.githubUrl ?? null,
      },
      rubric: criteria,
      scoresBreakdown,
      aiEvaluation: {
        status: evalStatus,
        summary: feedbackBits[0],
        strengths: criteria.filter((c) => c.passed === true).map((c) => c.label),
        improvements: criteria
          .filter((c) => c.passed === false)
          .map((c) => c.feedback || c.label),
        scoreJustification: feedbackBits.join(' '),
        criteria: criteria.map((c) => ({
          label: c.label,
          score: c.score,
          max: c.max,
          passed: c.passed,
          note: c.feedback,
        })),
        meta: scoresBreakdown
          ? {
            accuracy: scoresBreakdown.accuracy ?? null,
            code_quality: scoresBreakdown.code_quality ?? null,
            originality: scoresBreakdown.originality ?? null,
          }
          : undefined,
      },
      rawAiPayload: {
        scores_json: row?.scoresJson ?? null,
        criteria_results: row?.criteriaResultsJson ?? null,
        eval_runs: evalRuns.map((r) => ({
          id: r.id,
          status: r.status,
          harness_log: r.harnessLog,
          harness_output: r.harnessOutputJson,
          error_message: r.errorMessage,
          completed_at: r.completedAt?.toISOString() ?? null,
        })),
      },
      plagiarismScore: row?.plagiarismScore ?? null,
      aiProbability: row?.aiProbability ?? null,
    };
  }

  private buildVerbalStage(
    stage: JobProfileStageMysql,
    interview: CandidateAutonomousInterviewMysql | null,
  ): VerbalStageReport {
    const status = this.verbalStatusForStage(stage.stageType, interview);
    const hrAudit = interview?.hrVoiceAudit as Record<string, any> | undefined;
    const techAudit = interview?.stage1VoiceAudit as Record<string, any> | undefined;
    const isHr = stage.stageType === JobStageType.HR_VERBAL;

    const behaviouralWeighted = this.behaviouralScorePct(hrAudit);
    let voice = this.technicalVoiceScorePct(interview);
    if (
      voice == null &&
      stage.stageType === JobStageType.AI_VERBAL &&
      String(interview?.currentPhase ?? '') === 'completed'
    ) {
      const raw = this.asFiniteNumber(interview?.stage1VoiceScore);
      voice = raw != null ? raw * 10 : 0;
    }
    const code = interview?.codeQualityScore != null ? Number(interview.codeQualityScore) * 10 : null;
    const scorePct = this.verbalScorePct(stage.stageType, interview);
    const flaws = Array.isArray(interview?.architecturalFlaws)
      ? (interview!.architecturalFlaws as string[])
      : [];

    const audit = isHr ? hrAudit : techAudit;
    const scorecard = Array.isArray(audit?.rubric_scorecard) ? audit.rubric_scorecard : null;
    const hrComps = Array.isArray(audit?.competencies)
      ? audit.competencies
      : Array.isArray(audit?.competency_evaluations)
        ? audit.competency_evaluations
        : null;
    const timeMap = audit?.time_per_competency as Record<string, number> | undefined;
    const turnsMap = audit?.turns_per_competency as Record<string, number> | undefined;

    let competencies: Array<{ key: string; label: string; scorePct: number | null; note?: string; timeSpent?: number; turnCount?: number }> = [];
    if (hrComps && hrComps.length > 0) {
      competencies = hrComps.map((c: Record<string, any>, idx: number) => ({
        key: String(c.competency_id ?? `hr_${idx}`),
        label: String(c.name ?? c.competency_id ?? `Competency ${idx + 1}`),
        scorePct: (() => {
          const sc = this.asFiniteNumber(c.score);
          return sc != null ? sc * 20 : null; // 1–5 → 0–100
        })(),
        note: c.reasoning || c.level || undefined,
      }));
    } else if (scorecard && scorecard.length > 0) {
      competencies = scorecard.map((s, idx) => ({
        key: `rubric_${idx}`,
        label: s.competency || `Rubric ${idx + 1}`,
        scorePct: (() => {
          const raw = this.asFiniteNumber(s.score_10 ?? s.score);
          return raw != null ? raw * 10 : null;
        })(),
        note: s.justification || undefined,
        timeSpent: timeMap?.[s.id ?? s.competency] ? Math.round(timeMap[s.id ?? s.competency]) : undefined,
        turnCount: turnsMap?.[s.id ?? s.competency] ?? undefined,
      }));
    } else if (stage.stageType === JobStageType.AI_VERBAL) {
      competencies = [{ key: 'voice', label: 'AI Verbal', scorePct: voice }];
    } else {
      competencies = [
        { key: 'voice', label: 'Communication Clarity', scorePct: voice },
        { key: 'code_quality', label: 'Technical Problem Solving', scorePct: code },
        {
          key: 'alignment',
          label: 'Cultural & Values Alignment',
          scorePct: voice != null && code != null ? Math.round((voice + code) / 2) : voice ?? code,
        },
      ];
    }

    const outcome =
      typeof hrAudit?.final_outcome === 'string' ? String(hrAudit.final_outcome) : null;

    const thBlock = !isHr
      ? (techAudit?.take_home_verification as Record<string, unknown> | undefined)
      : undefined;
    const isProjectDefense = techAudit?.interview_mode === 'project_defense';
    if (thBlock?.enabled && Array.isArray(competencies)) {
      const thPct = this.asFiniteNumber(thBlock.take_home_verification_score_pct);
      const techPct = this.asFiniteNumber(thBlock.technical_score_pct);
      const thEntry = {
        key: isProjectDefense ? 'project_defense' : 'take_home_verification',
        label: `${isProjectDefense ? 'Project Defense' : 'Take-Home Verification'} (${this.asFiniteNumber(thBlock.take_home_weight_pct) ?? 0}%)`,
        scorePct: thPct,
        note:
          Array.isArray(thBlock.notes) && thBlock.notes.length
            ? `${thBlock.notes.length} ${isProjectDefense ? 'project' : 'verification'} question(s) scored`
            : undefined,
      };
      if (techPct != null) {
        competencies = [
          {
            key: 'technical_rubrics',
            label: `${isProjectDefense ? 'Competency' : 'Technical'} Rubrics (${this.asFiniteNumber(thBlock.technical_weight_pct) ?? 100}%)`,
            scorePct: techPct,
          },
          thEntry,
          ...competencies,
        ];
      } else if (isProjectDefense) {
        competencies = [thEntry, ...(scorecard?.length || hrComps?.length ? competencies : [])];
      }
    }

    const transcript = this.buildVerbalTranscript(stage.stageType, interview);
    const hrAuditOut =
      isHr && hrAudit && typeof hrAudit === 'object'
        ? (hrAudit as Record<string, unknown>)
        : null;

    // Always use this session's ses_ token — never the application portal token
    // (portal resolves to latest and mixes behavioral/technical recordings).
    const sessionToken = interview?.candidateToken ?? null;
    const stage1Chat = interview?.stage1ChatHistory;
    const stage3Chat = interview?.stage3ChatHistory;
    const hasVerbalChat =
      (Array.isArray(stage1Chat) && stage1Chat.length > 0) ||
      (Array.isArray(stage3Chat) && stage3Chat.length > 0);
    const aiVerbalDone =
      stage.stageType === JobStageType.AI_VERBAL &&
      (hasVerbalChat || String(interview?.currentPhase ?? '') === 'completed');

    const ps = (interview?.proctorSummary ?? {}) as Record<string, unknown>;
    const byType = (ps.by_type ?? {}) as Record<string, number>;
    const isTerminated = (byType['media_permission_terminated'] ?? 0) > 0;
    const isDisqualified =
      (isTerminated || String(interview?.finalDecision ?? '') === 'DISQUALIFIED') &&
      !ps.retake_allowed;

    const integrityDisqualification: IntegrityDisqualification | null = isDisqualified
      ? {
        disqualified: true,
        reason: isTerminated ? 'Proctoring integrity violation' : 'Integrity risk detected',
        details: isTerminated
          ? 'The session was closed after excessive camera or microphone interruptions.'
          : 'Suspicious proctoring activity was detected during the interview.',
        stageName: this.stageLabel(stage),
        stageId: String(stage.id),
        sessionToken: sessionToken ?? undefined,
        eventTime: ps.last_event_at ? String(ps.last_event_at) : undefined,
        fraudRiskScore: Number(ps.fraud_risk_score ?? 0),
        criticalCount: Number(ps.critical_count ?? 0),
        totalEvents: Number(ps.total_events ?? 0),
      }
      : null;

    const hasSessionReport =
      !!sessionToken &&
      !!(
        interview?.stage1VoiceAudit ||
        interview?.hrVoiceAudit ||
        interview?.screeningVoiceAudit ||
        interview?.recordingUrl ||
        aiVerbalDone ||
        stage.stageType === JobStageType.PROJECT_INTERVIEW ||
        isDisqualified ||
        Number(ps.total_events ?? 0) > 0
      );

    let durationMinutes: number | null = null;
    if (interview?.createdAt && interview?.updatedAt) {
      const diffMs = interview.updatedAt.getTime() - interview.createdAt.getTime();
      if (diffMs > 0) {
        durationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
    }

    return {
      stageType: stage.stageType as VerbalStageReport['stageType'],
      stageId: String(stage.id),
      label: this.stageLabel(stage),
      status,
      scorePct,
      durationMinutes,
      competencies,
      aiEvaluation: {
        status:
          status === 'evaluating'
            ? 'evaluating'
            : status === 'completed'
              ? 'ready'
              : status === 'pending' || status === 'in_progress'
                ? 'pending'
                : 'unavailable',
        summary:
          integrityDisqualification
            ? 'Interview terminated early — proctoring integrity violation (Disqualified)'
            : outcome
              ? `${outcome}${interview?.finalDecision ? ` (${interview.finalDecision})` : ''}`
              : interview?.finalDecision != null
                ? `Final decision: ${interview.finalDecision}`
                : undefined,
        strengths: scorePct != null && scorePct >= 70 ? ['Solid verbal performance'] : [],
        improvements: flaws,
        scoreJustification:
          behaviouralWeighted != null
            ? `Behavioural weighted score ${this.asFiniteNumber(hrAudit?.weighted_competency_score)?.toFixed(2) ?? '?'}/5 (~${Math.round(behaviouralWeighted)}/100)`
            : // Take-home only — Build & Defend justification is set after project summary attach.
            !isProjectDefense &&
              thBlock?.enabled &&
              this.asFiniteNumber(thBlock.final_combined_score_pct) != null
              ? `Interview ${this.asFiniteNumber(thBlock.technical_score_pct)?.toFixed(0) ?? '?'}% × ${this.asFiniteNumber(thBlock.technical_weight_pct) ?? '?'}% + Coding ${this.asFiniteNumber(thBlock.take_home_verification_score_pct)?.toFixed(0) ?? '?'}% × ${this.asFiniteNumber(thBlock.take_home_weight_pct) ?? '?'}% = ${Math.round(Number(thBlock.final_combined_score_pct))}/100`
              : voice != null
                ? `Voice score ${voice}/100`
                : undefined,
        meta: {
          finalDecision: interview?.finalDecision ?? null,
          currentPhase: interview?.currentPhase ?? null,
          platformDecision: hrAudit?.platform_decision ?? null,
          wrapReason: hrAudit?.wrap_reason ?? null,
          takeHomeEnabled: thBlock?.enabled === true,
          takeHomeWeightPct: this.asFiniteNumber(thBlock?.take_home_weight_pct),
          takeHomeScorePct: this.asFiniteNumber(thBlock?.take_home_verification_score_pct),
          technicalScorePct: this.asFiniteNumber(thBlock?.technical_score_pct),
          finalCombinedScorePct: this.asFiniteNumber(thBlock?.final_combined_score_pct),
        },
      },
      // Recording + transcript live only on the full interview report page
      // (View full interview report). Do not duplicate them on this stage tab.
      recordingUrl: null,
      interviewReportPath: hasSessionReport
        ? `/assessments/interview-reports/${encodeURIComponent(sessionToken!)}`
        : null,
      integrityDisqualification,
      endedByCandidate: this.candidateEndedInterview(interview),
      transcript: [],
      hrVoiceAudit: hrAuditOut,
      rawAiPayload: interview
        ? {
          stage1VoiceScore: interview.stage1VoiceScore,
          stage1VoiceAudit: interview.stage1VoiceAudit ?? null,
          codeQualityScore: interview.codeQualityScore,
          architecturalFlaws: interview.architecturalFlaws,
          finalDecision: interview.finalDecision,
          currentPhase: interview.currentPhase,
          sessionToken: interview.candidateToken,
        }
        : null,
    };
  }

  private buildVerbalTranscript(
    stageType: string,
    interview: CandidateAutonomousInterviewMysql | null,
  ): VerbalStageReport['transcript'] {
    if (!interview) return [];

    if (stageType === JobStageType.HR_VERBAL) {
      const hr = interview.hrVoiceAudit as Record<string, unknown> | null;
      const fromAudit = this.normalizeHrAuditTurns(hr);
      if (fromAudit.length) return fromAudit;

      const fromStage3 = this.normalizeChatHistory(interview.stage3ChatHistory);
      if (fromStage3.length) return fromStage3;

      // Some behavioural sessions persist chat on stage1 history by mistake — still prefer
      // this session's own history over another round.
      const fromStage1 = this.normalizeChatHistory(interview.stage1ChatHistory);
      if (fromStage1.length) return fromStage1;

      if (interview.screeningVoiceAudit) {
        const screeningAudit = interview.screeningVoiceAudit as Record<string, unknown>;
        const fromScreening = this.normalizeChatHistory(screeningAudit.transcript);
        if (fromScreening.length) return fromScreening;
      }
      return [];
    }

    const tech = interview.stage1VoiceAudit as Record<string, unknown> | null;
    const fromTech = this.normalizeHrAuditTurns(tech);
    if (fromTech.length) return fromTech;
    const fromStage1 = this.normalizeChatHistory(interview.stage1ChatHistory);
    if (fromStage1.length) return fromStage1;
    return this.normalizeChatHistory(interview.stage3ChatHistory);
  }

  private normalizeHrAuditTurns(
    audit: Record<string, unknown> | null | undefined,
  ): VerbalStageReport['transcript'] {
    if (!audit) return [];
    const rawTurns = Array.isArray(audit.turns)
      ? audit.turns
      : Array.isArray(audit.transcript)
        ? audit.transcript
        : Array.isArray(audit.chat_history)
          ? audit.chat_history
          : [];
    if (!rawTurns.length) return [];

    const out: VerbalStageReport['transcript'] = [];
    let idx = 0;
    for (const entry of rawTurns) {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;

      // Chat-style rows inside audit.turns / transcript
      const roleRaw = String(item.role ?? item.speaker ?? '').toLowerCase();
      const chatText = String(item.content ?? item.text ?? item.message ?? '').trim();
      if (chatText && (roleRaw || !item.turn)) {
        const role: 'agent' | 'candidate' =
          roleRaw === 'user' || roleRaw === 'candidate' || roleRaw === 'human'
            ? 'candidate'
            : 'agent';
        idx += 1;
        out.push({ turnIndex: idx, role, text: chatText });
        continue;
      }

      const nested =
        item.turn && typeof item.turn === 'object'
          ? (item.turn as Record<string, unknown>)
          : item;
      const question = String(
        nested.question_text ??
        nested.question_asked ??
        item.question_text ??
        item.question_asked ??
        '',
      ).trim();
      const reply = String(
        nested.candidate_answer_raw ??
        nested.candidate_reply ??
        nested.answer ??
        item.candidate_answer_raw ??
        item.candidate_reply ??
        '',
      ).trim();
      const competencyId =
        String(nested.competency_id ?? item.competency_id ?? '') || null;
      if (question) {
        idx += 1;
        out.push({ turnIndex: idx, role: 'agent', text: question, competencyId });
      }
      if (reply) {
        idx += 1;
        out.push({ turnIndex: idx, role: 'candidate', text: reply, competencyId });
      }
    }
    return out;
  }

  private normalizeChatHistory(raw: unknown): VerbalStageReport['transcript'] {
    let rows: unknown = raw;
    if (typeof rows === 'string') {
      try {
        rows = JSON.parse(rows);
      } catch {
        return [];
      }
    }
    if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
      const obj = rows as Record<string, unknown>;
      rows =
        obj.messages ??
        obj.history ??
        obj.chat_history ??
        obj.transcript ??
        obj.turns ??
        [];
    }
    if (!Array.isArray(rows)) return [];
    const out: VerbalStageReport['transcript'] = [];
    let idx = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const roleRaw = String(r.role ?? r.speaker ?? '').toLowerCase();
      const text = String(r.content ?? r.text ?? r.message ?? '').trim();
      if (!text) continue;
      const role: 'agent' | 'candidate' =
        roleRaw === 'user' || roleRaw === 'candidate' || roleRaw === 'human'
          ? 'candidate'
          : 'agent';
      idx += 1;
      out.push({ turnIndex: idx, role, text });
    }
    return out;
  }

  private normalizeCodingAi(
    feedback: string | undefined,
    status: NormalizedAiEvaluation['status'],
  ): NormalizedAiEvaluation {
    if (!feedback) {
      return { status, strengths: [], improvements: [] };
    }
    const lines = feedback
      .split(/[\n.;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const strengths = lines.filter((l) =>
      /strong|good|optimal|clean|excellent|well/i.test(l),
    );
    const improvements = lines.filter((l) =>
      /improve|weak|missing|could|should|lack|memory|edge/i.test(l),
    );
    return {
      status,
      summary: feedback,
      strengths: strengths.length ? strengths.slice(0, 5) : lines.slice(0, 2),
      improvements: improvements.slice(0, 5),
      scoreJustification: feedback,
    };
  }

  private codingStatus(row: CodingRoundSubmissionEntity | null | undefined): StageEvalStatus {
    if (!row) return 'pending';
    if (row.status === 'grading') return 'evaluating';
    if (row.status === 'in_progress') return 'in_progress';
    if (row.status === 'error') return 'failed';
    if (row.status === 'submitted') return 'completed';
    return 'pending';
  }

  private takeHomeStatus(row: TakeHomeSubmissionMysql | null | undefined): StageEvalStatus {
    if (!row) return 'pending';
    switch (row.status) {
      case TakeHomeSubmissionStatus.GRADING:
        return 'evaluating';
      case TakeHomeSubmissionStatus.GRADED:
        return 'completed';
      case TakeHomeSubmissionStatus.SUBMITTED:
        return 'in_review';
      case TakeHomeSubmissionStatus.IN_PROGRESS:
      case TakeHomeSubmissionStatus.ASSIGNED:
        return 'in_progress';
      case TakeHomeSubmissionStatus.FAILED:
      case TakeHomeSubmissionStatus.EXPIRED:
        return 'failed';
      default:
        return 'pending';
    }
  }

  /** Coerce JSON numeric fields that may arrive as strings from MySQL. */
  private asFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /** Human-readable Build & Defend mix — matches Project Submission cards. */
  private projectInterviewScoreJustification(
    project: VerbalStageReport['project'] | null | undefined,
  ): string | undefined {
    if (!project) return undefined;
    const code = this.asFiniteNumber(project.code_build_score_pct);
    const verbal = this.asFiniteNumber(project.verbal_defend_score_pct);
    const final = this.asFiniteNumber(project.final_combined_score_pct);
    if (code == null && verbal == null && final == null) return undefined;

    const codeW = this.asFiniteNumber(project.scoring_weights?.code_submission) ?? 40;
    const interviewW =
      this.asFiniteNumber(project.scoring_weights?.interview_performance) ?? 60;
    const finalLabel = final != null ? String(Math.round(final)) : '?';

    if (code != null && verbal != null) {
      return `Code build ${Math.round(code)}% × ${codeW}% + Verbal defend ${Math.round(verbal)}% × ${interviewW}% = ${finalLabel}/100`;
    }
    if (verbal != null) {
      return `Verbal defend ${Math.round(verbal)}% (code build unavailable) × ${interviewW}% = ${finalLabel}/100`;
    }
    if (code != null) {
      return `Code build ${Math.round(code)}% (verbal defend unavailable) × ${codeW}% = ${finalLabel}/100`;
    }
    return `Final combined ${finalLabel}/100`;
  }

  private behaviouralScorePct(hrAudit: Record<string, any> | null | undefined): number | null {
    const weighted = this.asFiniteNumber(hrAudit?.weighted_competency_score);
    return weighted != null ? weighted * 20 : null; // 1–5 → ~0–100
  }

  private technicalVoiceScorePct(
    interview: CandidateAutonomousInterviewMysql | null | undefined,
  ): number | null {
    if (!interview) return null;
    // Only treat stage1VoiceScore as technical when a tech audit exists,
    // otherwise HR completion may have written a behavioural score into stage1VoiceScore.
    const techAudit = interview.stage1VoiceAudit;
    if (!techAudit || typeof techAudit !== 'object') return null;
    const audit = techAudit as Record<string, unknown>;
    const th = audit.take_home_verification as Record<string, unknown> | undefined;
    const combined =
      this.asFiniteNumber(th?.final_combined_score_pct) ??
      this.asFiniteNumber(audit.final_combined_score_pct);
    if (combined != null) return combined;

    // Check exact decimal weighted_overall_10 from rubric evaluation
    const weighted10 = this.asFiniteNumber(audit.weighted_overall_10);
    if (weighted10 != null) return Math.round(weighted10 * 100) / 10;

    // Check decimal depth_score or secondary depth score
    const depthScore = this.asFiniteNumber(audit.depth_score ?? audit.depth_score_secondary);
    if (depthScore != null) return Math.round(depthScore * 100) / 10;

    // Check rubric scorecard average if available
    const scorecard = Array.isArray(audit.rubric_scorecard) ? audit.rubric_scorecard : null;
    if (scorecard && scorecard.length > 0) {
      const validScores = scorecard
        .map((s: Record<string, any>) => this.asFiniteNumber(s.score_10 ?? s.score))
        .filter((s): s is number => s != null);
      if (validScores.length > 0) {
        const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
        return Math.round(avg * 100) / 10;
      }
    }

    const raw = this.asFiniteNumber(interview.stage1VoiceScore);
    return raw != null ? raw * 10 : null;
  }

  private verbalScorePct(
    stageType: string,
    interview: CandidateAutonomousInterviewMysql | null | undefined,
  ): number | null {
    if (!interview) return null;
    if (stageType === JobStageType.HR_VERBAL) {
      return this.behaviouralScorePct(interview.hrVoiceAudit as Record<string, any> | undefined);
    }
    // AI_VERBAL / SCREENING: technical evidence only — never borrow HR score
    const voice = this.technicalVoiceScorePct(interview);
    if (voice != null) return voice;
    if (stageType === JobStageType.AI_VERBAL && String(interview.currentPhase ?? '') === 'completed') {
      const raw = this.asFiniteNumber(interview.stage1VoiceScore);
      return raw != null ? raw * 10 : 0;
    }
    if (interview.codeQualityScore != null) {
      const code = this.asFiniteNumber(interview.codeQualityScore);
      return code != null ? code * 10 : null;
    }
    return null;
  }

  /**
   * Per-stage verbal status. One shared interview row must NOT mark every
   * verbal stage completed when only HR (or only tech) finished.
   */
  private verbalStatusForStage(
    stageType: string,
    interview: CandidateAutonomousInterviewMysql | null | undefined,
  ): StageEvalStatus {
    if (!interview) return 'pending';

    const phase = String(interview.currentPhase ?? '');
    const hasHr =
      interview.hrVoiceAudit != null &&
      typeof interview.hrVoiceAudit === 'object' &&
      Object.keys(interview.hrVoiceAudit as object).length > 0;
    const hasTech =
      (interview.stage1VoiceAudit != null &&
        typeof interview.stage1VoiceAudit === 'object' &&
        Object.keys(interview.stage1VoiceAudit as object).length > 0) ||
      this.technicalVoiceScorePct(interview) != null;

    if (stageType === JobStageType.HR_VERBAL) {
      if (hasHr) return 'completed';
      if (phase === 'hr_verbal') return 'in_progress';
      return 'pending';
    }

    if (stageType === JobStageType.PROJECT_INTERVIEW) {
      const bndPhase = String(
        (interview.proctorSummary as Record<string, unknown> | null)?.bndPhase ?? '',
      );
      // The Build session is marked completed on code submit, while Defend is still ahead.
      if (phase === 'completed' && bndPhase !== 'build') return 'completed';
      if (
        phase === 'completed' ||
        phase === 'bnd_assessment' ||
        phase === 'bnd_interview' ||
        phase === 'in_build' ||
        phase === 'ready_for_interview'
      ) {
        return 'in_progress';
      }
      return 'pending';
    }

    // AI_VERBAL / SCREENING
    if (hasTech) return 'completed';
    if (stageType === JobStageType.AI_VERBAL && phase === 'completed') return 'completed';
    if (phase === 'intro_verbal' || phase === 'sandbox_code' || phase === 'closing') {
      return 'in_progress';
    }
    return 'pending';
  }

  private computeReportStatus(
    app: JobApplicationMysql,
    rounds: RoundSummaryItem[],
  ): ReportStatus {
    if (app.pendingHumanReview) return 'under_review';
    if (app.status === JobApplicationStatus.REJECTED) return 'failed';
    if (
      app.status === JobApplicationStatus.COMPLETED ||
      app.status === JobApplicationStatus.HIRED
    ) {
      return 'passed';
    }
    if (rounds.some((r) => r.status === 'failed')) return 'failed';
    if (rounds.some((r) => r.status === 'in_review')) return 'under_review';
    return 'in_progress';
  }

  private computeRecommendation(input: {
    overallScorePct: number | null;
    pendingHumanReview: boolean;
    applicationStatus: JobApplicationStatus | string;
    stages: Array<{ status?: StageEvalStatus; scorePct?: number | null }>;
  }): Recommendation {
    if (input.applicationStatus === JobApplicationStatus.REJECTED) return 'reject';

    const terminal =
      input.applicationStatus === JobApplicationStatus.COMPLETED ||
      input.applicationStatus === JobApplicationStatus.HIRED;

    // Terminal applications should not flip back to "evaluating" because a later
    // profile config added pending stages.
    if (!terminal) {
      if (
        input.applicationStatus === JobApplicationStatus.IN_PROGRESS ||
        input.stages.some(
          (s) =>
            s.status === 'evaluating' ||
            s.status === 'in_progress' ||
            s.status === 'pending',
        )
      ) {
        return 'evaluating';
      }
    }

    if (input.pendingHumanReview) return 'under_review';

    if (input.overallScorePct == null) {
      return 'under_review';
    }

    if (input.overallScorePct >= 85) return 'strong_hire';
    if (input.overallScorePct >= 70) return 'hire';
    return 'reject';
  }

  private buildActionRequired(
    app: JobApplicationMysql,
    stages: AssessmentStageReport[],
  ): { message: string } | null {
    if (app.pendingHumanReview) {
      const pending = stages.find((s) => s.status === 'in_review');
      const label = pending?.label ?? 'a stage';
      return {
        message: `Action Required: ${label} pending human review. Sign-off needed before progression.`,
      };
    }
    const takeHome = stages.find(
      (s) => s.stageType === 'take_home' && s.status === 'in_review',
    );
    if (takeHome) {
      return {
        message: `Action Required: Take-home round pending sign-off. ${stages.filter((s) => s.status === 'completed').length} of ${stages.length} stages verified.`,
      };
    }
    return null;
  }

  private async computeCohortRank(
    jobProfileId: string,
    overallScorePct: number | null,
  ): Promise<{ topPercent: number; cohortSize: number } | null> {
    if (overallScorePct == null) return null;
    const { items } = await this.buildFilteredItems(
      { jobProfileId: String(jobProfileId) },
      { paginate: false },
    );
    const scored = items
      .map((i) => i.overallScorePct)
      .filter((s): s is number => s != null)
      .sort((a, b) => b - a);
    if (scored.length < 2) return null;
    const better = scored.filter((s) => s > overallScorePct).length;
    const topPercent = Math.max(1, Math.round(((better + 1) / scored.length) * 100));
    return { topPercent, cohortSize: scored.length };
  }

  private async loadProblems(ids: string[]) {
    const map = new Map<string, ProblemBankProblemMysql>();
    if (!ids.length) return map;
    const rows = await this.problems.find({ where: { id: In(ids) } });
    for (const row of rows) map.set(String(row.id), row);
    return map;
  }

  private stageLabel(stage: JobProfileStageMysql): string {
    if (stage.name?.trim()) return stage.name;
    switch (stage.stageType) {
      case JobStageType.CODING:
        return 'Coding';
      case JobStageType.TAKE_HOME:
        return 'Take-home';
      case JobStageType.SCREENING:
        return 'Screening';
      case JobStageType.AI_SCREENING:
        return 'AI Screening';
      case JobStageType.AI_VERBAL:
        return 'AI Verbal';
      case JobStageType.HR_VERBAL:
        return 'HR Verbal';
      case JobStageType.PROJECT_INTERVIEW:
        return 'Build & Defend';
      default:
        return stage.stageType;
    }
  }

  private buildAiScreeningStage(
    stage: JobProfileStageMysql,
    interview: CandidateAutonomousInterviewMysql | null,
  ): AiScreeningStageReport {
    const audit =
      interview?.screeningVoiceAudit && typeof interview.screeningVoiceAudit === 'object'
        ? (interview.screeningVoiceAudit as Record<string, unknown>)
        : null;
    const analyzerStatus = String(audit?.analyzerStatus ?? 'PENDING');
    const result = (audit?.screeningResult as { checks?: unknown[] } | null) ?? null;
    const checks = Array.isArray(result?.checks) ? result!.checks : [];
    let status: StageEvalStatus = 'pending';
    if (analyzerStatus === 'COMPLETED') status = 'completed';
    else if (analyzerStatus === 'FAILED') status = 'failed';
    else if (audit) status = 'evaluating';

    const transcriptFromAudit = this.normalizeChatHistory(audit?.transcript);
    const transcript =
      transcriptFromAudit.length > 0
        ? transcriptFromAudit
        : this.normalizeChatHistory(interview?.stage1ChatHistory);

    let durationMinutes: number | null = null;
    if (interview?.createdAt && interview?.updatedAt) {
      const diffMs = interview.updatedAt.getTime() - interview.createdAt.getTime();
      if (diffMs > 0) {
        durationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
    }

    return {
      stageType: 'ai_screening',
      stageId: String(stage.id),
      label: this.stageLabel(stage),
      status,
      scorePct: null,
      durationMinutes,
      analyzerStatus,
      checks,
      conversationState: audit?.conversationState ?? null,
      transcript,
      recordingUrl: this.roundRecordingUrl(interview, AutonomousInterviewRoundType.AI_SCREENING)
        ?? (interview?.candidateToken ? `recordings/${interview.candidateToken}_ai_screening/final.mp4` : null),
      interviewReportPath: interview?.candidateToken
        ? `/assessments/interview-reports/${encodeURIComponent(interview.candidateToken)}`
        : null,
      endedByCandidate: this.candidateEndedInterview(interview),
      aiEvaluation: {
        status:
          analyzerStatus === 'COMPLETED'
            ? 'ready'
            : analyzerStatus === 'FAILED'
              ? 'unavailable'
              : 'evaluating',
        strengths: [],
        improvements: [],
        summary:
          analyzerStatus === 'PENDING'
            ? 'Screening analysis pending. Soft flags only — no score or hiring recommendation.'
            : analyzerStatus === 'FAILED'
              ? 'Screening analysis failed / needs review. Retry available — no fabricated flags.'
              : analyzerStatus === 'COMPLETED' && checks.length === 0
                ? 'No configured requirements to evaluate. Conversation captured for HR review.'
                : analyzerStatus === 'COMPLETED'
                  ? 'Soft flags for HR review only — no score or hiring recommendation from this stage.'
                  : undefined,
      },
      rawAiPayload: audit,
    };
  }

  private candidateName(c: CandidateMysql): string {
    return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email;
  }

  private initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
}
