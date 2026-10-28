import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodingRoundSubmissionEntity } from './coding-round-submission.entity';
import { CodingRoundService } from './coding-round.service';
import { CodingRoundProblemPickerService } from './coding-round-problem-picker.service';
import { CodingRoundLiveKitService } from './coding-round-livekit.service';
import { CodingRoundController } from './coding-round.controller';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';
import { JobProfilesModule } from '../job-profiles/job-profiles.module';
import { RoundSnapshotModule } from '../assessment-reports/round-snapshot.module';
import { AutonomousInterviewModule } from '../autonomous-interview/autonomous-interview.module';
import { InterviewRecordingMysql } from '../autonomous-interview/entities/interview-recording.mysql.entity';
import { ProctorModule } from '../proctor/proctor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CodingRoundSubmissionEntity, InterviewRecordingMysql]),
    AssessmentAiModule,
    RoundSnapshotModule,
    ProctorModule,
    forwardRef(() => JobProfilesModule),
    forwardRef(() => AutonomousInterviewModule),
  ],
  providers: [
    CodingRoundService,
    CodingRoundProblemPickerService,
    CodingRoundLiveKitService,
  ],
  controllers: [CodingRoundController],
  exports: [CodingRoundService, CodingRoundLiveKitService],
})
export class CodingRoundModule {}
