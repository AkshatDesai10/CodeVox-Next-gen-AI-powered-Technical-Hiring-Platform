import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PLAGIARISM_JOB_RUN, PLAGIARISM_QUEUE } from '../../../queue/queue.constants';
import type { PlagiarismJobPayload } from './plagiarism.constants';
import { PlagiarismSchedulerService } from './plagiarism-scheduler.service';

@Processor(PLAGIARISM_QUEUE)
export class PlagiarismProcessor extends WorkerHost {
  private readonly log = new Logger(PlagiarismProcessor.name);

  constructor(private readonly scheduler: PlagiarismSchedulerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== PLAGIARISM_JOB_RUN) {
      this.log.warn(`Unknown plagiarism job: ${job.name}`);
      return;
    }
    await this.scheduler.processJob(job.data as PlagiarismJobPayload);
  }
}
