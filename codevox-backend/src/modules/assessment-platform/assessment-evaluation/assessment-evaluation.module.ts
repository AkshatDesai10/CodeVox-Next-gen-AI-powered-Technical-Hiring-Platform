import { Module, forwardRef } from '@nestjs/common';
import { AssessmentExecutionModule } from '../../assessment-execution/assessment-execution.module';
import { AssessmentAiModule } from '../assessment-ai/assessment-ai.module';
import {
  AiEvaluationStrategy,
  EvaluationStrategyResolver,
  HybridEvaluationStrategy,
  TestCaseEvaluationStrategy,
} from './evaluation-strategies';

@Module({
  imports: [forwardRef(() => AssessmentExecutionModule), AssessmentAiModule],
  providers: [
    TestCaseEvaluationStrategy,
    AiEvaluationStrategy,
    HybridEvaluationStrategy,
    EvaluationStrategyResolver,
  ],
  exports: [EvaluationStrategyResolver],
})
export class AssessmentEvaluationModule {}
