import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AI_DETECTION_JOB_RUN, AI_DETECTION_QUEUE } from '../../../queue/queue.constants';
import type { AiDetectionJobPayload } from './ai-detection.constants';
import { AiDetectionSchedulerService } from './ai-detection-scheduler.service';

@Processor(AI_DETECTION_QUEUE)
export class AiDetectionProcessor extends WorkerHost {
  private readonly log = new Logger(AiDetectionProcessor.name);

  constructor(private readonly scheduler: AiDetectionSchedulerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AI_DETECTION_JOB_RUN) {
      this.log.warn(`Unknown AI detection job: ${job.name}`);
      return;
    }
    await this.scheduler.processJob(job.data as AiDetectionJobPayload);
  }
}
