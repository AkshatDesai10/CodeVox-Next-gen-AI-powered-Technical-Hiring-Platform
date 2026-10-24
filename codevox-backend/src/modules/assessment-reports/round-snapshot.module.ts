import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CandidateAutonomousInterviewMysql } from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRoundMysql } from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { AutonomousInterviewRoundsRepository } from '../autonomous-interview/autonomous-interview-rounds.repository';
import { CodingRoundSubmissionEntity } from '../coding-round/coding-round-submission.entity';
import { JobApplicationMysql } from '../job-profiles/entities/job-application.mysql.entity';
import { JobProfileStageMysql } from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { TakeHomeSubmissionMysql } from '../take-home/entities/take-home-submission.mysql.entity';
import { ProjectInterviewModule } from '../project-interview/project-interview.module';
import { ApplicationRoundSnapshotMysql } from './entities/application-round-snapshot.mysql.entity';
import { RoundSnapshotService } from './round-snapshot.service';

@Module({
  imports: [
    ProjectInterviewModule,
    TypeOrmModule.forFeature([
      ApplicationRoundSnapshotMysql,
      JobApplicationMysql,
      JobProfileStageMysql,
      CodingRoundSubmissionEntity,
      TakeHomeSubmissionMysql,
      CandidateAutonomousInterviewMysql,
      AutonomousInterviewRoundMysql,
    ]),
  ],
  providers: [RoundSnapshotService, AutonomousInterviewRoundsRepository],
  exports: [RoundSnapshotService, TypeOrmModule],
})
export class RoundSnapshotModule {}
