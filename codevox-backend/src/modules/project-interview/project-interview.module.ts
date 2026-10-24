import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';
import { JobProfileAiLogMysql } from '../job-profiles/entities/job-profile-ai-log.mysql.entity';
import { CandidateAutonomousInterviewMysql } from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRoundMysql } from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { JobApplicationMysql } from '../job-profiles/entities/job-application.mysql.entity';
import { JobProfileMysql } from '../job-profiles/entities/job-profile.mysql.entity';
import { JobProfileStageMysql } from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { ProjectInterviewSubmissionMysql } from './entities/project-interview-submission.mysql.entity';
import { ExcelGraderService } from './excel-grader.service';
import { ProjectEvaluationService } from './project-evaluation.service';
import { PROJECT_EVALUATION_LLM, ProjectInterviewLlmClient } from './project-interview-llm.client';
import { ProjectInterviewController } from './project-interview.controller';
import { ProjectInterviewService } from './project-interview.service';
import { GitRepoSnapshotFetcher, REPO_SNAPSHOT_FETCHER } from './repo-snapshot.fetcher';

/**
 * Deliberately does not import AutonomousInterviewModule (avoids circular DI).
 * Build-session recording stop is resolved lazily via ModuleRef at runtime.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectInterviewSubmissionMysql,
      JobProfileStageMysql,
      JobApplicationMysql,
      JobProfileMysql,
      CandidateMysql,
      CandidateAutonomousInterviewMysql,
      AutonomousInterviewRoundMysql,
      JobProfileAiLogMysql,
    ]),
    AssessmentAiModule,
  ],
  controllers: [ProjectInterviewController],
  providers: [
    ProjectInterviewService,
    ProjectEvaluationService,
    ExcelGraderService,
    ProjectInterviewLlmClient,
    { provide: PROJECT_EVALUATION_LLM, useExisting: ProjectInterviewLlmClient },
    GitRepoSnapshotFetcher,
    { provide: REPO_SNAPSHOT_FETCHER, useExisting: GitRepoSnapshotFetcher },
  ],
  exports: [ProjectInterviewService],
})
export class ProjectInterviewModule {}
