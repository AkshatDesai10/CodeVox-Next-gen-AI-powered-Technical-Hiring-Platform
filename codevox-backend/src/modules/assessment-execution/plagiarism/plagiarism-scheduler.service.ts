import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { isRedisEnabled } from '../../../config/redis-enabled';
import { PLAGIARISM_JOB_RUN, PLAGIARISM_QUEUE } from '../../../queue/queue.constants';
import { AssessmentExecutionRepository } from '../assessment-execution.repository';
import type { PlagiarismJobPayload } from './plagiarism.constants';
import { PlagiarismDetectorService } from './plagiarism-detector.service';

@Injectable()
export class PlagiarismSchedulerService {
  private readonly log = new Logger(PlagiarismSchedulerService.name);
  private readonly redisEnabled = isRedisEnabled();

  constructor(
    private readonly detector: PlagiarismDetectorService,
    private readonly repo: AssessmentExecutionRepository,
    @Optional() @InjectQueue(PLAGIARISM_QUEUE) private readonly queue?: Queue,
  ) {}

  /** Schedule Dolos plagiarism checks for unchecked coding submissions (final submit). */
  async scheduleAttemptPlagiarism(
    candidateId: string,
    candidateAssessmentId: string,
  ): Promise<void> {
    const pending = await this.repo.listSubmissionsPendingPlagiarism(candidateAssessmentId);
    if (!pending.length) {
      this.log.debug(`No pending plagiarism checks for attempt=${candidateAssessmentId}`);
      return;
    }

    for (const row of pending) {
      this.scheduleCheck({
        candidateId,
        candidateAssessmentId,
        questionId: row.questionId,
        language: row.language,
        sourceCode: row.sourceCode,
      });
    }

    this.log.debug(
      `Scheduled plagiarism for ${pending.length} question(s) attempt=${candidateAssessmentId}`,
    );
  }

  /** Fire-and-forget — never blocks the HTTP response. */
  scheduleCheck(payload: PlagiarismJobPayload): void {
    if (this.redisEnabled && this.queue) {
      void this.queue
        .add(PLAGIARISM_JOB_RUN, payload, {
          jobId: `plagiarism_${payload.candidateAssessmentId}_${payload.questionId}`,
          removeOnComplete: 500,
          removeOnFail: 2000,
        })
        .catch((err) => {
          this.log.warn(`Failed to enqueue plagiarism job: ${String(err)}`);
          this.runInline(payload);
        });
      return;
    }
    this.runInline(payload);
  }

  async processJob(payload: PlagiarismJobPayload): Promise<void> {
    const score = await this.detector.runPlagiarismCheck(payload);
    await this.detector.persistPlagiarismResult(payload, score);
    this.log.debug(
      `Plagiarism check question=${payload.questionId} attempt=${payload.candidateAssessmentId} score=${score}`,
    );
  }

  private runInline(payload: PlagiarismJobPayload): void {
    void this.processJob(payload).catch((err) => {
      this.log.error(
        `Inline plagiarism check failed question=${payload.questionId}: ${String(err)}`,
      );
    });
  }
}
