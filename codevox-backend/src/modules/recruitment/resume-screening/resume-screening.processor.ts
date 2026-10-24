import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  RESUME_SCREENING_JOB_RUN,
  RESUME_SCREENING_QUEUE,
} from '../../../queue/queue.constants';
import { ResumeScreeningService } from './resume-screening.service';
import type { ResumeScreenJobPayload } from './resume-screening.types';

@Processor(RESUME_SCREENING_QUEUE)
export class ResumeScreeningProcessor extends WorkerHost {
  private readonly log = new Logger(ResumeScreeningProcessor.name);

  constructor(private readonly screening: ResumeScreeningService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== RESUME_SCREENING_JOB_RUN) {
      this.log.warn(`Unknown resume screening job: ${job.name}`);
      return;
    }
    await this.screening.processJob(job.data as ResumeScreenJobPayload);
  }
}
