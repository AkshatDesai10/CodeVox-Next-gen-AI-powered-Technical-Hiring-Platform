import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../../authorization/authorization.module';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import { CandidateAutonomousInterviewMysql } from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRoundMysql } from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { AutonomousInterviewRoundsRepository } from '../autonomous-interview/autonomous-interview-rounds.repository';
import { CodingRoundSubmissionEntity } from '../coding-round/coding-round-submission.entity';
import { JobApplicationMysql } from '../job-profiles/entities/job-application.mysql.entity';
import { JobProfileMysql } from '../job-profiles/entities/job-profile.mysql.entity';
import { JobProfileStageMysql } from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { ProblemBankProblemMysql } from '../job-profiles/entities/problem-bank-problem.mysql.entity';
import { RecruitmentLeadOverlayMysql } from '../recruitment/entities/recruitment-lead-overlay.mysql.entity';
import { AssessmentReportsController } from './assessment-reports.controller';
import { AssessmentReportsService } from './assessment-reports.service';
import { RoundSnapshotModule } from './round-snapshot.module';
import { ProjectInterviewModule } from '../project-interview/project-interview.module';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';

@Module({
  imports: [
    AuthorizationModule,
    AssessmentAiModule,
    RoundSnapshotModule,
    ProjectInterviewModule,
    TypeOrmModule.forFeature([
      JobApplicationMysql,
      JobProfileMysql,
      JobProfileStageMysql,
      CandidateMysql,
      CodingRoundSubmissionEntity,
      CandidateAutonomousInterviewMysql,
      AutonomousInterviewRoundMysql,
      ProblemBankProblemMysql,
      RecruitmentLeadOverlayMysql,
    ]),
  ],
  controllers: [AssessmentReportsController],
  providers: [AssessmentReportsService, AutonomousInterviewRoundsRepository],
  exports: [AssessmentReportsService],
})
export class AssessmentReportsModule {}
