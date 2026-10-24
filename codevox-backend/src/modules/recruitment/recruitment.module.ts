import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';
import { JobProfilesModule } from '../job-profiles/job-profiles.module';
import { JobApplicationMysql } from '../job-profiles/entities/job-application.mysql.entity';
import { RecruitmentLeadOverlayMysql } from './entities/recruitment-lead-overlay.mysql.entity';
import { RecruitmentInterviewOverlayMysql } from './entities/recruitment-interview-overlay.mysql.entity';
import {
  RecruitmentActivityLogMysql,
  RecruitmentCommunicationLogMysql,
  RecruitmentInterviewStatusHistoryMysql,
  RecruitmentLeadInterviewLinkMysql,
} from './entities/recruitment-support.mysql.entity';
import { RecruitmentRepository } from './recruitment.repository';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentAiService } from './recruitment-ai.service';
import { RecruitmentController } from './recruitment.controller';
import { ResumeScreeningModule } from './resume-screening/resume-screening.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecruitmentLeadOverlayMysql,
      RecruitmentInterviewOverlayMysql,
      RecruitmentLeadInterviewLinkMysql,
      RecruitmentCommunicationLogMysql,
      RecruitmentActivityLogMysql,
      RecruitmentInterviewStatusHistoryMysql,
      JobApplicationMysql,
      CandidateMysql,
    ]),
    AuthorizationModule,
    forwardRef(() => JobProfilesModule),
    AssessmentAiModule,
    forwardRef(() => ResumeScreeningModule),
  ],
  controllers: [RecruitmentController],
  providers: [RecruitmentRepository, RecruitmentService, RecruitmentAiService],
  exports: [RecruitmentService, RecruitmentRepository, ResumeScreeningModule],
})
export class RecruitmentModule {}
