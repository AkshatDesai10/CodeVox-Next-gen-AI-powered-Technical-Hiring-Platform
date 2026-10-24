import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenAiClientService } from './openai-client.service';
import { AiQuestionGeneratorService } from './ai-question-generator.service';
import { AiEvaluationService } from './ai-evaluation.service';
import { JobProfileAiLogMysql } from '../../job-profiles/entities/job-profile-ai-log.mysql.entity';

@Module({
  imports: [TypeOrmModule.forFeature([JobProfileAiLogMysql])],
  providers: [OpenAiClientService, AiQuestionGeneratorService, AiEvaluationService],
  exports: [OpenAiClientService, AiQuestionGeneratorService, AiEvaluationService],
})
export class AssessmentAiModule {}
