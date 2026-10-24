import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isRedisEnabled } from '../../config/redis-enabled';
import { AssessmentPlatformModule } from '../assessment-platform/assessment-orchestrator/assessment-platform.module';
import { AssessmentReportsModule } from '../assessment-reports/assessment-reports.module';
import { AssessmentMysql } from './entities/assessment.mysql.entity';
import { QuestionMysql } from './entities/question.mysql.entity';
import { QuestionTestCaseMysql } from './entities/question-test-case.mysql.entity';
import { AssessmentQuestionMysql } from './entities/assessment-question.mysql.entity';
import { CandidateAssessmentMysql } from './entities/candidate-assessment.mysql.entity';
import { SubmissionMysql } from './entities/submission.mysql.entity';
import { CandidateMysql } from './entities/candidate.mysql.entity';
import { AssessmentExecutionRepository } from './assessment-execution.repository';
import { AssessmentExecutionService } from './assessment-execution.service';
import { ExecutionService } from './services/execution.service';
import { DockerRunnerService } from './services/docker-runner.service';
import { EvaluationService } from './services/evaluation.service';
import { EXECUTION_PROVIDER } from './interfaces/execution-provider.interface';
import { AssessmentExecutionController } from './assessment-execution.controller';
import { AssessmentAdminController } from './assessment-admin.controller';
import { WorkspaceController } from './workspace/workspace.controller';
import { WorkspaceContainerService } from './workspace/workspace-container.service';
import { WorkspaceService } from './workspace/workspace.service';
import { WorkspaceTerminalGateway } from './workspace/workspace-terminal.gateway';
import { StrategyRegistry } from './execution/strategy-registry';
import { ExecutionOrchestratorService } from './execution/execution-orchestrator.service';
import { PlagiarismDetectorService } from './plagiarism/plagiarism-detector.service';
import { PlagiarismSchedulerService } from './plagiarism/plagiarism-scheduler.service';
import { PlagiarismProcessor } from './plagiarism/plagiarism.processor';
import { AiEvaluationClientService } from './ai-detection/ai-evaluation-client.service';
import { AiDetectionSchedulerService } from './ai-detection/ai-detection-scheduler.service';
import { AiDetectionProcessor } from './ai-detection/ai-detection.processor';

const plagiarismProcessors = isRedisEnabled() ? [PlagiarismProcessor] : [];
const aiDetectionProcessors = isRedisEnabled() ? [AiDetectionProcessor] : [];

@Module({
  imports: [
    forwardRef(() => AssessmentPlatformModule),
    AssessmentReportsModule,
    TypeOrmModule.forFeature([      AssessmentMysql,
      QuestionMysql,
      QuestionTestCaseMysql,
      AssessmentQuestionMysql,
      CandidateAssessmentMysql,
      SubmissionMysql,
      CandidateMysql,
    ]),
  ],
  controllers: [AssessmentExecutionController, AssessmentAdminController, WorkspaceController],
  providers: [
    AssessmentExecutionRepository,
    AssessmentExecutionService,
    EvaluationService,
    ExecutionService,
    StrategyRegistry,
    ExecutionOrchestratorService,
    DockerRunnerService,
    WorkspaceContainerService,
    WorkspaceService,
    WorkspaceTerminalGateway,
    PlagiarismDetectorService,
    PlagiarismSchedulerService,
    ...plagiarismProcessors,
    AiEvaluationClientService,
    AiDetectionSchedulerService,
    ...aiDetectionProcessors,
    {
      provide: EXECUTION_PROVIDER,
      useClass: DockerRunnerService,
    },
  ],
  exports: [AssessmentExecutionService, AssessmentExecutionRepository, EvaluationService, WorkspaceService, PlagiarismSchedulerService, AiDetectionSchedulerService],
})
export class AssessmentExecutionModule {}
