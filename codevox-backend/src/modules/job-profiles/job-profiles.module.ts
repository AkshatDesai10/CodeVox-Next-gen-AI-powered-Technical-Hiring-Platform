import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { AutonomousInterviewModule } from '../autonomous-interview/autonomous-interview.module';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import { AssessmentTemplateMysql } from '../assessment-platform/assessment-engine/entities/assessment-template.mysql.entity';
import { JobProfileMysql } from './entities/job-profile.mysql.entity';
import { JobProfileStageMysql } from './entities/job-profile-stage.mysql.entity';
import { JobProfileCompetencyMysql } from './entities/job-profile-competency.mysql.entity';
import { JobProfileQuestionMysql } from './entities/job-profile-question.mysql.entity';
import { JobApplicationMysql } from './entities/job-application.mysql.entity';
import { JobProfileVersionMysql } from './entities/job-profile-version.mysql.entity';
import { JobProfileApprovalMysql } from './entities/job-profile-approval.mysql.entity';
import { CompetencyLibraryMysql } from './entities/competency-library.mysql.entity';
import { QuestionLibraryMysql } from './entities/question-library.mysql.entity';
import { JobProfilePreviewAuditMysql } from './entities/job-profile-preview-audit.mysql.entity';
import { JobProfileStallAlertMysql } from './entities/job-profile-stall-alert.mysql.entity';
import { JobProfileAiLogMysql } from './entities/job-profile-ai-log.mysql.entity';
import { QuestionBankQuestionMysql } from './entities/question-bank-question.mysql.entity';
import { QuestionBankVersionMysql } from './entities/question-bank-version.mysql.entity';
import { QuestionBankSetMysql } from './entities/question-bank-set.mysql.entity';
import { QuestionBankSetItemMysql } from './entities/question-bank-set-item.mysql.entity';
import { ProblemBankProblemMysql } from './entities/problem-bank-problem.mysql.entity';
import { ProblemBankVersionMysql } from './entities/problem-bank-version.mysql.entity';
import { ProblemBankLanguageTemplateMysql } from './entities/problem-bank-language-template.mysql.entity';
import { ProblemBankTestCaseMysql } from './entities/problem-bank-test-case.mysql.entity';
import { ProblemBankSetMysql } from './entities/problem-bank-set.mysql.entity';
import { ProblemBankSetItemMysql } from './entities/problem-bank-set-item.mysql.entity';
import { InterviewRoundQuestionSnapshotMysql } from './entities/interview-round-question-snapshot.mysql.entity';
import { InterviewRoundProblemSnapshotMysql } from './entities/interview-round-problem-snapshot.mysql.entity';
import { JobProfilesRepository } from './job-profiles.repository';
import { JobProfilesService } from './job-profiles.service';
import { JobProfilesPhase2Service } from './job-profiles-phase2.service';
import { JobProfilesAiService } from './job-profiles-ai.service';
import { JobProfilePipelineService } from './job-profile-pipeline.service';
import { JobProfileStallScheduler } from './job-profile-stall.scheduler';
import { JobProfilesController } from './job-profiles.controller';
import { CandidatePortalController } from './candidate-portal.controller';
import { CandidatePortalService } from './candidate-portal.service';
import { TakeHomeModule } from '../take-home/take-home.module';
import { RecruitmentModule } from '../recruitment/recruitment.module';
import { ProjectInterviewModule } from '../project-interview/project-interview.module';
import { RoundSnapshotModule } from '../assessment-reports/round-snapshot.module';
import { AssessmentReportsModule } from '../assessment-reports/assessment-reports.module';
import { AssessmentExecutionModule } from '../assessment-execution/assessment-execution.module';

@Module({
  imports: [
    AssessmentExecutionModule,
    forwardRef(() => AssessmentReportsModule),
    TypeOrmModule.forFeature([
      JobProfileMysql,
      JobProfileStageMysql,
      JobProfileCompetencyMysql,
      JobProfileQuestionMysql,
      JobApplicationMysql,
      JobProfileVersionMysql,
      JobProfileApprovalMysql,
      CompetencyLibraryMysql,
      QuestionLibraryMysql,
      JobProfilePreviewAuditMysql,
      JobProfileStallAlertMysql,
      JobProfileAiLogMysql,
      QuestionBankQuestionMysql,
      QuestionBankVersionMysql,
      QuestionBankSetMysql,
      QuestionBankSetItemMysql,
      ProblemBankProblemMysql,
      ProblemBankVersionMysql,
      ProblemBankLanguageTemplateMysql,
      ProblemBankTestCaseMysql,
      ProblemBankSetMysql,
      ProblemBankSetItemMysql,
      InterviewRoundQuestionSnapshotMysql,
      InterviewRoundProblemSnapshotMysql,
      CandidateMysql,
      AssessmentTemplateMysql,
    ]),
    AuthorizationModule,
    AssessmentAiModule,
    RoundSnapshotModule,
    forwardRef(() => AutonomousInterviewModule),
    forwardRef(() => TakeHomeModule),
    forwardRef(() => RecruitmentModule),
    ProjectInterviewModule,
  ],
  controllers: [JobProfilesController, CandidatePortalController],
  providers: [
    JobProfilesRepository,
    JobProfilesService,
    JobProfilesPhase2Service,
    JobProfilesAiService,
    JobProfilePipelineService,
    JobProfileStallScheduler,
    CandidatePortalService,
  ],
  exports: [
    JobProfilesService,
    JobProfilesRepository,
    JobProfilePipelineService,
    JobProfilesPhase2Service,
    JobProfilesAiService,
    CandidatePortalService,
  ],
})
export class JobProfilesModule {}
