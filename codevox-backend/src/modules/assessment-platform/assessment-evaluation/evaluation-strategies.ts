import { Injectable } from '@nestjs/common';
import { AiEvaluationService } from '../assessment-ai/ai-evaluation.service';
import { AssessmentExecutionRepository } from '../../assessment-execution/assessment-execution.repository';
import { EvaluationService } from '../../assessment-execution/services/evaluation.service';
import { SubmissionStatus } from '../../assessment-execution/submission-status.enum';
import type { EvaluationContext, EvaluationResult, EvaluationStrategy } from '../shared/interfaces';
import { EvaluationStrategyType } from '../shared/enums';

@Injectable()
export class TestCaseEvaluationStrategy implements EvaluationStrategy {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly repo: AssessmentExecutionRepository,
  ) {}

  supports(mode: EvaluationStrategyType) {
    return mode === EvaluationStrategyType.TESTCASE;
  }

  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const testCases = await this.repo.resolveAllTestCases(ctx.questionId);
    const result = await this.evaluation.evaluateQuestion(
      { questionId: ctx.questionId, title: ctx.questionTitle, marks: ctx.marks },
      ctx.language,
      ctx.sourceCode,
      testCases,
      ctx.environmentConfig,
      ctx.questionJson ?? null,
      ctx.evaluationConfig ?? null,
    );
    return {
      score: result.score,
      maxScore: ctx.marks,
      status: result.status,
      executionTime: result.executionTime,
      executionOutput: result.executionOutput,
      strategy: EvaluationStrategyType.TESTCASE,
      passedTests: result.passedTests,
      totalTests: result.totalTests,
      percentage: result.percentage,
    };
  }
}

@Injectable()
export class AiEvaluationStrategy implements EvaluationStrategy {
  constructor(private readonly aiEval: AiEvaluationService) {}

  supports(mode: EvaluationStrategyType) {
    return mode === EvaluationStrategyType.AI;
  }

  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    return this.aiEval.evaluate(ctx);
  }
}

@Injectable()
export class HybridEvaluationStrategy implements EvaluationStrategy {
  constructor(
    private readonly testCase: TestCaseEvaluationStrategy,
    private readonly ai: AiEvaluationStrategy,
  ) {}

  supports(mode: EvaluationStrategyType) {
    return mode === EvaluationStrategyType.HYBRID;
  }

  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const weights = (ctx.evaluationConfig?.weights as { tests?: number; ai?: number }) ?? {
      tests: 0.6,
      ai: 0.4,
    };
    const testWeight = weights.tests ?? 0.6;
    const aiWeight = weights.ai ?? 0.4;

    const [testResult, aiResult] = await Promise.all([
      this.testCase.evaluate(ctx),
      this.ai.evaluate(ctx),
    ]);

    const maxScore = ctx.marks;
    const blended = testResult.score * testWeight + aiResult.score * aiWeight;
    const score = Math.min(blended, maxScore);
    const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;

    let status = SubmissionStatus.FAILED;
    if (pct >= 100) status = SubmissionStatus.PASSED;
    else if (pct >= 40) status = SubmissionStatus.PARTIAL;

    return {
      score,
      maxScore,
      status,
      executionTime: testResult.executionTime + aiResult.executionTime,
      executionOutput: testResult.executionOutput,
      strategy: EvaluationStrategyType.HYBRID,
      strengths: aiResult.strengths,
      weaknesses: aiResult.weaknesses,
      recommendations: aiResult.recommendations,
      rubricJson: aiResult.rubricJson,
      passedTests: testResult.passedTests,
      totalTests: testResult.totalTests,
      percentage: pct,
    };
  }
}

@Injectable()
export class EvaluationStrategyResolver {
  constructor(
    private readonly testCase: TestCaseEvaluationStrategy,
    private readonly ai: AiEvaluationStrategy,
    private readonly hybrid: HybridEvaluationStrategy,
  ) {}

  resolve(mode: EvaluationStrategyType): EvaluationStrategy {
    if (mode === EvaluationStrategyType.AI) return this.ai;
    if (mode === EvaluationStrategyType.HYBRID) return this.hybrid;
    return this.testCase;
  }
}
