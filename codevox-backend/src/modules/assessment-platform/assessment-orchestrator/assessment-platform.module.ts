import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentExecutionModule } from '../../assessment-execution/assessment-execution.module';
import { AssessmentAiModule } from '../assessment-ai/assessment-ai.module';
import { AssessmentEvaluationModule } from '../assessment-evaluation/assessment-evaluation.module';
import { AssessmentEnvironmentModule } from '../assessment-environment/assessment-environment.module';
import { AssessmentInterviewModule } from '../assessment-interview/assessment-interview.module';
import { AssessmentOrchestratorService } from './assessment-orchestrator.service';
import { AssessmentPlatformRepository } from './assessment-platform.repository';
import { AssessmentPlatformAdminController } from './assessment-platform-admin.controller';
import { SessionQuestionQueueMysql } from '../entities/session-question-queue.mysql.entity';
import { EvaluationReviewMysql } from '../entities/evaluation-review.mysql.entity';
import { QuestionMysql } from '../../assessment-execution/entities/question.mysql.entity';
import { QuestionTestCaseMysql } from '../../assessment-execution/entities/question-test-case.mysql.entity';
import { McqOptionMysql } from '../entities/mcq-option.mysql.entity';
import { AssessmentMysql } from '../../assessment-execution/entities/assessment.mysql.entity';
import { CandidateMysql } from '../../assessment-execution/entities/candidate.mysql.entity';
import { AssessmentQuestionMysql } from '../../assessment-execution/entities/assessment-question.mysql.entity';
import { CandidateAssessmentMysql } from '../../assessment-execution/entities/candidate-assessment.mysql.entity';

@Module({
  imports: [
    forwardRef(() => AssessmentExecutionModule),
    AssessmentAiModule,
    AssessmentEvaluationModule,
    AssessmentEnvironmentModule,
    AssessmentInterviewModule,
    TypeOrmModule.forFeature([
      SessionQuestionQueueMysql,
      EvaluationReviewMysql,
      QuestionMysql,
      QuestionTestCaseMysql,
      McqOptionMysql,
      AssessmentMysql,
      CandidateMysql,
      AssessmentQuestionMysql,
      CandidateAssessmentMysql,
    ]),
  ],
  controllers: [AssessmentPlatformAdminController],
  providers: [AssessmentOrchestratorService, AssessmentPlatformRepository],
  exports: [AssessmentOrchestratorService, AssessmentPlatformRepository],
})
export class AssessmentPlatformModule {}
