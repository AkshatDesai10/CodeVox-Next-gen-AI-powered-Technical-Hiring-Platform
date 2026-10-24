import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApplicationMysql, JobApplicationStatus } from './entities/job-application.mysql.entity';
import { JobProfileMysql } from './entities/job-profile.mysql.entity';
import { JobProfileStageMysql } from './entities/job-profile-stage.mysql.entity';
import { JobProfilesRepository } from './job-profiles.repository';
import {
  evaluateInterviewThreshold,
  evaluateStageSkipRules,
  parseProgressionConfig,
  type RoundFinishResult,
  type StageSkipRules,
  type ThresholdConfig,
} from './job-profiles-phase2.util';
import { AutonomousInterviewDecision } from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { RoundSnapshotService } from '../assessment-reports/round-snapshot.service';
import { AssessmentReportsService } from '../assessment-reports/assessment-reports.service';

@Injectable()
export class JobProfilePipelineService {
  private readonly logger = new Logger(JobProfilePipelineService.name);

  constructor(
    private readonly repo: JobProfilesRepository,
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(JobProfileMysql)
    private readonly profiles: Repository<JobProfileMysql>,
    @InjectRepository(JobProfileStageMysql)
    private readonly stages: Repository<JobProfileStageMysql>,
    private readonly roundSnapshots: RoundSnapshotService,
    @Inject(forwardRef(() => AssessmentReportsService))
    private readonly assessmentReports: AssessmentReportsService,
  ) {}

  async resolveThresholdForInterview(params: {
    jobProfileId: string | null;
    candidateToken: string;
    voiceScore?: number | null;
    codeScore?: number | null;
    finalDecision?: string;
  }) {
    if (!params.jobProfileId) {
      return {
        pending_human_review: true,
        auto_action: null,
        suggested: 'review' as const,
        final_decision: AutonomousInterviewDecision.UNDER_REVIEW,
      };
    }

    const profile = await this.profiles.findOne({
      where: { id: params.jobProfileId, inactive: 0 },
    });
    const threshold = (profile?.thresholdConfig ?? {}) as ThresholdConfig;
    const result = evaluateInterviewThreshold(threshold, {
      voiceScore: params.voiceScore,
      codeScore: params.codeScore,
    });

    const app = await this.applications.findOne({
      where: { candidateToken: params.candidateToken, inactive: 0 },
    });
    if (app) {
      await this.applications.update(
        { id: app.id },
        {
          pendingHumanReview: result.pendingHumanReview ? 1 : 0,
          autoAction: result.autoAction,
          scoredVersionId: profile?.version != null ? String(profile.version) : app.scoredVersionId,
        },
      );
      if (!result.pendingHumanReview && result.autoAction === 'reject') {
        await this.applications.update({ id: app.id }, { status: JobApplicationStatus.REJECTED });
      }
    }

    let finalDecision = AutonomousInterviewDecision.UNDER_REVIEW;
    if (result.suggested === 'reject' && !result.pendingHumanReview) {
      finalDecision = AutonomousInterviewDecision.AUTO_REJECT;
    } else if (result.suggested === 'advance' && !result.pendingHumanReview) {
      finalDecision = AutonomousInterviewDecision.AUTO_PASS_TO_OFFER;
    }

    return {
      pending_human_review: result.pendingHumanReview,
      auto_action: result.autoAction,
      suggested: result.suggested,
      final_decision: finalDecision,
      required_score: threshold.auto_advance_min_score ?? 7.5,
    };
  }

  /**
   * Called after a scored round finishes. Applies progression_config:
   * - sequential: always unlock next (last stage → COMPLETED for HR review)
   * - elimination: score must meet threshold or application is REJECTED
   */
  async finishRound(
    candidateToken: string,
    params: {
      score: number;
      stageId?: string | null;
      experienceYears?: number | null;
      skills?: string[];
      voiceScore?: number | null;
    },
  ): Promise<RoundFinishResult> {
    const score = Math.max(0, Math.min(100, Number(params.score) || 0));
    const app = await this.applications.findOne({
      where: { candidateToken, inactive: 0 },
    });
    if (!app) {
      return {
        outcome: 'completed',
        score,
        threshold: null,
        mode: 'sequential',
        next_stage: null,
        message: 'Application not found.',
      };
    }

    const profile = await this.profiles.findOne({
      where: { id: app.jobProfileId, inactive: 0 },
    });
    const progression = parseProgressionConfig(
      (profile?.progressionConfig ?? null) as Record<string, unknown> | null,
    );

    if (progression.mode === 'elimination' && score < progression.elimination_threshold) {
      await this.applications.update(
        { id: app.id },
        {
          status: JobApplicationStatus.REJECTED,
          autoAction: 'eliminated',
          pendingHumanReview: 0,
        },
      );
      return {
        outcome: 'eliminated',
        score,
        threshold: progression.elimination_threshold,
        mode: 'elimination',
        next_stage: null,
        message: `Score ${score}% is below the required ${progression.elimination_threshold}% to unlock the next round.`,
      };
    }

    const advanced = await this.advanceApplicationStage(candidateToken, {
      experienceYears: params.experienceYears,
      skills: params.skills,
      voiceScore: params.voiceScore,
      preferCompletedOnEnd: true,
    });

    if (advanced?.completed) {
      void this.assessmentReports
        .ensureOverallEvaluationForApplication(String(app.id))
        .catch((error) => {
          this.logger.warn(
            `Overall evaluation failed for application ${app.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return {
        outcome: 'completed',
        score,
        threshold: progression.mode === 'elimination' ? progression.elimination_threshold : null,
        mode: progression.mode,
        next_stage: null,
        message: 'All rounds are complete. HR will review your application.',
      };
    }

    if (advanced?.advanced && advanced.stage_id) {
      return {
        outcome: 'advanced',
        score,
        threshold: progression.mode === 'elimination' ? progression.elimination_threshold : null,
        mode: progression.mode,
        next_stage: {
          id: advanced.stage_id,
          name: advanced.stage_name ?? 'Next round',
          type: advanced.stage_type ?? 'custom',
        },
        message: `You scored ${score}%. The next round is unlocked.`,
      };
    }

    return {
      outcome: 'completed',
      score,
      threshold: progression.mode === 'elimination' ? progression.elimination_threshold : null,
      mode: progression.mode,
      next_stage: null,
      message: 'Pipeline update finished.',
    };
  }

  async advanceApplicationStage(
    candidateToken: string,
    ctx?: {
      experienceYears?: number | null;
      skills?: string[];
      voiceScore?: number | null;
      /** When true (finishRound), last stage → COMPLETED instead of HIRED */
      preferCompletedOnEnd?: boolean;
    },
  ) {
    const app = await this.applications.findOne({
      where: { candidateToken, inactive: 0 },
    });
    if (!app) return null;
    if (app.status === JobApplicationStatus.REJECTED) return null;

    const allStages = await this.stages.find({
      where: { jobProfileId: app.jobProfileId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const snapshots = await this.roundSnapshots.ensureForApplication(String(app.id));
    const assignedPipeline = this.roundSnapshots.pipelineStagesForApplication(
      app,
      allStages,
      snapshots,
    );
    const stageList =
      assignedPipeline.length > 0
        ? assignedPipeline
        : await this.repo.listStages(app.jobProfileId);
    const currentIdx = stageList.findIndex((s) => String(s.id) === String(app.currentStageId));
    let nextIdx = currentIdx + 1;

    while (nextIdx < stageList.length) {
      const stage = stageList[nextIdx]!;
      const skip = evaluateStageSkipRules(
        (stage.skipRules ?? null) as StageSkipRules | null,
        {
          experienceYears: ctx?.experienceYears,
          skills: ctx?.skills,
          voiceScore: ctx?.voiceScore,
        },
      );
      if (!skip) break;
      nextIdx += 1;
    }

    const nextStage = stageList[nextIdx];
    if (!nextStage) {
      await this.applications.update(
        { id: app.id },
        {
          status: ctx?.preferCompletedOnEnd
            ? JobApplicationStatus.COMPLETED
            : JobApplicationStatus.HIRED,
          stageEnteredAt: new Date(),
          pendingHumanReview: ctx?.preferCompletedOnEnd ? 1 : app.pendingHumanReview,
          autoAction: ctx?.preferCompletedOnEnd ? 'awaiting_hr_review' : app.autoAction,
        },
      );
      return { advanced: false, completed: true };
    }

    await this.applications.update(
      { id: app.id },
      {
        currentStageId: nextStage.id,
        stageEnteredAt: new Date(),
        status: JobApplicationStatus.IN_PROGRESS,
      },
    );
    return {
      advanced: true,
      stage_id: nextStage.id,
      stage_name: nextStage.name,
      stage_type: nextStage.stageType,
    };
  }
}
