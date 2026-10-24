import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentExecutionModule } from '../../assessment-execution/assessment-execution.module';
import { AssessmentAiModule } from '../assessment-ai/assessment-ai.module';
import { AssessmentEnvironmentModule } from '../assessment-environment/assessment-environment.module';
import { McqOptionMysql } from '../entities/mcq-option.mysql.entity';
import { JobProfileAiLogMysql } from '../../job-profiles/entities/job-profile-ai-log.mysql.entity';
import { AssessmentMysql } from '../../assessment-execution/entities/assessment.mysql.entity';
import { QuestionMysql } from '../../assessment-execution/entities/question.mysql.entity';
import { AssessmentQuestionMysql } from '../../assessment-execution/entities/assessment-question.mysql.entity';
import { CandidateAssessmentMysql } from '../../assessment-execution/entities/candidate-assessment.mysql.entity';
import { AssessmentTemplateMysql } from './entities/assessment-template.mysql.entity';
import { AssessmentSessionMysql } from './entities/assessment-session.mysql.entity';
import { AssessmentWorkspaceMysql } from './entities/assessment-workspace.mysql.entity';
import { AssessmentSessionSubmissionMysql } from './entities/assessment-session-submission.mysql.entity';
import { EvaluationResultMysql } from './entities/evaluation-result.mysql.entity';
import { CandidateQuestionResponseMysql } from './entities/candidate-question-response.mysql.entity';
import { QuestionEvaluationMysql } from './entities/question-evaluation.mysql.entity';
import { AssessmentEngineController } from './assessment-engine.controller';
import { AssessmentEngineService } from './services/assessment-engine.service';
import { AssessmentEngineRepository } from './services/assessment-engine.repository';
import {
  DockerWorkspaceProvider,
  NoneWorkspaceProvider,
  WorkspaceProviderRegistry,
} from './providers/docker-workspace.provider';
import {
  AiEvaluationProvider,
  EvaluationProviderRegistry,
  HybridEvaluationProvider,
  TestCaseEvaluationProvider,
} from './providers/evaluation-providers';

@Module({
  imports: [
    forwardRef(() => AssessmentExecutionModule),
    AssessmentAiModule,
    AssessmentEnvironmentModule,
    TypeOrmModule.forFeature([
      AssessmentTemplateMysql,
      AssessmentSessionMysql,
      AssessmentWorkspaceMysql,
      AssessmentSessionSubmissionMysql,
      EvaluationResultMysql,
      CandidateQuestionResponseMysql,
      QuestionEvaluationMysql,
      AssessmentMysql,
      QuestionMysql,
      AssessmentQuestionMysql,
      CandidateAssessmentMysql,
      JobProfileAiLogMysql,
      McqOptionMysql,
    ]),
  ],
  controllers: [AssessmentEngineController],
  providers: [
    AssessmentEngineService,
    AssessmentEngineRepository,
    NoneWorkspaceProvider,
    DockerWorkspaceProvider,
    WorkspaceProviderRegistry,
    TestCaseEvaluationProvider,
    AiEvaluationProvider,
    HybridEvaluationProvider,
    EvaluationProviderRegistry,
  ],
  exports: [AssessmentEngineService, AssessmentEngineRepository],
})
export class AssessmentEngineModule {}
