import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentAiModule } from '../../assessment-platform/assessment-ai/assessment-ai.module';
import { JobProfileAiLogMysql } from '../../job-profiles/entities/job-profile-ai-log.mysql.entity';
import { JobProfilesModule } from '../../job-profiles/job-profiles.module';
import { isRedisEnabled } from '../../../config/redis-enabled';
import { RecruitmentLeadOverlayMysql } from '../entities/recruitment-lead-overlay.mysql.entity';
import { RecruitmentInterviewOverlayMysql } from '../entities/recruitment-interview-overlay.mysql.entity';
import { RecruitmentInterviewTimeSlotMysql } from '../entities/recruitment-interview-time-slot.mysql.entity';
import {
  RecruitmentActivityLogMysql,
  RecruitmentCommunicationLogMysql,
  RecruitmentInterviewStatusHistoryMysql,
  RecruitmentLeadInterviewLinkMysql,
} from '../entities/recruitment-support.mysql.entity';
import { RecruitmentRepository } from '../recruitment.repository';
import { ResumeCvContentService } from './resume-cv-content.service';
import { ResumeScreeningEngine } from './resume-screening.engine';
import { ResumeScreeningJobResolver } from './resume-screening-job.resolver';
import { ResumeScreeningProcessor } from './resume-screening.processor';
import { ResumeScreeningService } from './resume-screening.service';

const redisProviders = isRedisEnabled() ? [ResumeScreeningProcessor] : [];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecruitmentLeadOverlayMysql,
      RecruitmentInterviewOverlayMysql,
      RecruitmentInterviewTimeSlotMysql,
      RecruitmentLeadInterviewLinkMysql,
      RecruitmentCommunicationLogMysql,
      RecruitmentActivityLogMysql,
      RecruitmentInterviewStatusHistoryMysql,
      JobProfileAiLogMysql,
    ]),
    AssessmentAiModule,
    forwardRef(() => JobProfilesModule),
  ],
  providers: [
    RecruitmentRepository,
    ResumeCvContentService,
    ResumeScreeningJobResolver,
    ResumeScreeningEngine,
    ResumeScreeningService,
    ...redisProviders,
  ],
  exports: [ResumeScreeningService],
})
export class ResumeScreeningModule {}
