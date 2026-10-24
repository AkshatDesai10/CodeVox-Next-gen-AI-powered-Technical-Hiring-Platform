import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { isRedisEnabled } from '../../../config/redis-enabled';
import { AI_DETECTION_JOB_RUN, AI_DETECTION_QUEUE } from '../../../queue/queue.constants';
import { AssessmentExecutionRepository } from '../assessment-execution.repository';
import type { AiDetectionJobPayload } from './ai-detection.constants';
import { QuestionType } from '../question-type.enum';
import { resolveAiTechStack } from './ai-detection.constants';
import { AiEvaluationClientService } from './ai-evaluation-client.service';

@Injectable()
export class AiDetectionSchedulerService {
  private readonly log = new Logger(AiDetectionSchedulerService.name);
  private readonly redisEnabled = isRedisEnabled();

  constructor(
    private readonly evaluationClient: AiEvaluationClientService,
    private readonly repo: AssessmentExecutionRepository,
    @Optional() @InjectQueue(AI_DETECTION_QUEUE) private readonly queue?: Queue,
  ) {}

  /** Schedule AI analysis for all unchecked submissions on an attempt (final submit). */
  async scheduleAttemptAnalysis(
    candidateId: string,
    candidateAssessmentId: string,
  ): Promise<void> {
    const pending = await this.repo.listSubmissionsPendingAiAnalysis(candidateAssessmentId);
    if (!pending.length) {
      this.log.debug(`No pending AI analysis for attempt=${candidateAssessmentId}`);
      return;
    }

    for (const row of pending) {
      this.scheduleCheck({
        candidateId,
        candidateAssessmentId,
        questionId: row.questionId,
        language: row.language,
        sourceCode: row.sourceCode,
        questionType: row.questionType,
      });
    }

    this.log.debug(
      `Scheduled AI analysis for ${pending.length} question(s) attempt=${candidateAssessmentId}`,
    );
  }

  /** Fire-and-forget — never blocks the HTTP response. */
  scheduleCheck(payload: AiDetectionJobPayload): void {
    if (this.redisEnabled && this.queue) {
      void this.queue
        .add(AI_DETECTION_JOB_RUN, payload, {
          jobId: `ai_detection_${payload.candidateAssessmentId}_${payload.questionId}`,
          removeOnComplete: 500,
          removeOnFail: 2000,
        })
        .catch((err) => {
          this.log.warn(`Failed to enqueue AI detection job: ${String(err)}`);
          this.runInline(payload);
        });
      return;
    }
    this.runInline(payload);
  }

  async processJob(payload: AiDetectionJobPayload): Promise<void> {
    const [hasDetection, hasEvaluation] = await Promise.all([
      this.repo.submissionHasAiDetection(payload.candidateAssessmentId, payload.questionId),
      this.repo.submissionHasCodeEvaluation(payload.candidateAssessmentId, payload.questionId),
    ]);
    if (hasDetection && hasEvaluation) {
      this.log.debug(
        `AI analysis already complete question=${payload.questionId} attempt=${payload.candidateAssessmentId}`,
      );
      return;
    }

    const techStack = resolveAiTechStack(
      payload.questionType ?? QuestionType.CODING,
      payload.language,
    );
    const analysis = await this.evaluationClient.analyzeSubmission(
      payload.candidateId,
      payload.questionId,
      payload.sourceCode,
      techStack,
    );

    if (analysis === null) {
      this.log.debug(
        `AI analysis skipped question=${payload.questionId} attempt=${payload.candidateAssessmentId}`,
      );
      return;
    }

    if (analysis.detection && !hasDetection) {
      await this.repo.patchSubmissionAiDetection({
        candidateAssessmentId: payload.candidateAssessmentId,
        questionId: payload.questionId,
        aiProbability: analysis.detection.aiProbability,
        detection: {
          aiProbability: analysis.detection.aiProbability,
          flagged: analysis.detection.flagged,
          signals: analysis.detection.signals,
        },
      });
      await this.repo.refreshAttemptAiAggregate(payload.candidateAssessmentId);
    }

    if (analysis.evaluation && !hasEvaluation) {
      await this.repo.patchSubmissionCodeEvaluation({
        candidateAssessmentId: payload.candidateAssessmentId,
        questionId: payload.questionId,
        evaluation: {
          score: analysis.evaluation.score,
          architecturalFlaws: analysis.evaluation.architecturalFlaws,
          isProductionReady: analysis.evaluation.isProductionReady,
        },
      });
    }

    this.log.debug(
      `AI analysis question=${payload.questionId} attempt=${payload.candidateAssessmentId} ` +
        `detection=${analysis.detection?.aiProbability ?? 'skipped'} ` +
        `evaluation=${analysis.evaluation?.score ?? 'skipped'}`,
    );
  }

  private runInline(payload: AiDetectionJobPayload): void {
    void this.processJob(payload).catch((err) => {
      this.log.error(
        `Inline AI analysis failed question=${payload.questionId}: ${String(err)}`,
      );
    });
  }
}
