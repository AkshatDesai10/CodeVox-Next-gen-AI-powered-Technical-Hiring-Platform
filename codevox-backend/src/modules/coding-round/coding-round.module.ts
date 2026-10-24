import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodingRoundSubmissionEntity } from './coding-round-submission.entity';
import { CodingRoundService } from './coding-round.service';
import { CodingRoundProblemPickerService } from './coding-round-problem-picker.service';
import { CodingRoundController } from './coding-round.controller';
import { AssessmentAiModule } from '../assessment-platform/assessment-ai/assessment-ai.module';
import { JobProfilesModule } from '../job-profiles/job-profiles.module';
import { RoundSnapshotModule } from '../assessment-reports/round-snapshot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CodingRoundSubmissionEntity]),
    AssessmentAiModule,
    RoundSnapshotModule,
    forwardRef(() => JobProfilesModule),
  ],
  providers: [CodingRoundService, CodingRoundProblemPickerService],
  controllers: [CodingRoundController],
  exports: [CodingRoundService],
})
export class CodingRoundModule {}
