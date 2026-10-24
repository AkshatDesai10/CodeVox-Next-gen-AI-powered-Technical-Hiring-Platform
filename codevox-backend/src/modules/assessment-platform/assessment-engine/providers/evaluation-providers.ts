import { Injectable } from '@nestjs/common';
import { AiEvaluationService } from '../../assessment-ai/ai-evaluation.service';
import { EvaluationService } from '../../../assessment-execution/services/evaluation.service';
import type { EvaluationProvider, SectionEvaluationContext } from './evaluation-provider.interface';
import type { EvaluationJson } from '../types/assessment-document.types';

@Injectable()
export class AiEvaluationProvider implements EvaluationProvider {
  readonly mode = 'ai' as const;

  constructor(private readonly aiEval: AiEvaluationService) {}

  supports(mode: string): boolean {
    return mode === 'ai';
  }

  async evaluate(ctx: SectionEvaluationContext): Promise<EvaluationJson> {
    const sourceCode = String(
      ctx.submission.sourceCode ?? ctx.submission.text ?? ctx.submission.architecture ?? '',
    );
    const result = await this.aiEval.evaluate({
      candidateAssessmentId: ctx.sessionId,
      questionId: ctx.section.id,
      questionTitle: ctx.section.title,
      marks: ctx.section.marks ?? 20,
      language: String(ctx.submission.language ?? 'TEXT'),
      sourceCode,
      questionType: ctx.section.component,
      evaluationConfig: ctx.section.evaluation ?? null,
      problemDescription: ctx.section.prompt,
    });

    return {
      overallScore: result.score,
      maxScore: result.maxScore,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      recommendations: result.recommendations,
      criteriaScores: (result.rubricJson as Record<string, number>) ?? {},
      strategy: 'ai',
      raw: result as unknown as Record<string, unknown>,
    };
  }
}

@Injectable()
export class TestCaseEvaluationProvider implements EvaluationProvider {
  readonly mode = 'testcase' as const;

  constructor(private readonly evaluation: EvaluationService) {}

  supports(mode: string): boolean {
    return mode === 'testcase';
  }

  async evaluate(ctx: SectionEvaluationContext): Promise<EvaluationJson> {
    const testCases = ctx.section.evaluation?.testCases ?? [];
    const language = String(ctx.submission.language ?? 'PYTHON').toUpperCase();
    const sourceCode = String(ctx.submission.sourceCode ?? '');

    if (!testCases.length || ctx.section.component !== 'code_editor') {
      return {
        overallScore: 0,
        maxScore: ctx.section.marks ?? 20,
        strategy: 'testcase',
        weaknesses: ['No test cases configured for this section'],
      };
    }

    const questionRow = {
      questionId: ctx.section.id,
      title: ctx.section.title,
      marks: ctx.section.marks ?? 20,
    };

    const cases = testCases.map((tc, i) => ({
      id: String(i + 1),
      questionId: ctx.section.id,
      input: tc.input ?? '',
      expectedOutput: tc.expectedOutput ?? '',
      isHidden: tc.isHidden ? 1 : 0,
      inactive: 0,
    }));

    const result = await this.evaluation.evaluateQuestion(
      questionRow,
      language,
      sourceCode,
      cases as never,
      ctx.document.workspace ?? null,
    );

    const maxScore = ctx.section.marks ?? 20;
    const score = (result.passedTests / Math.max(result.totalTests, 1)) * maxScore;

    return {
      overallScore: Math.round(score * 100) / 100,
      maxScore,
      strategy: 'testcase',
      criteriaScores: {
        passedTests: result.passedTests,
        totalTests: result.totalTests,
      },
      raw: result as unknown as Record<string, unknown>,
    };
  }
}

@Injectable()
export class HybridEvaluationProvider implements EvaluationProvider {
  readonly mode = 'hybrid' as const;

  constructor(
    private readonly testcase: TestCaseEvaluationProvider,
    private readonly ai: AiEvaluationProvider,
  ) {}

  supports(mode: string): boolean {
    return mode === 'hybrid';
  }

  async evaluate(ctx: SectionEvaluationContext): Promise<EvaluationJson> {
    const [tc, ai] = await Promise.all([
      this.testcase.evaluate(ctx),
      this.ai.evaluate(ctx),
    ]);
    const maxScore = ctx.section.marks ?? 20;
    const overallScore =
      Math.round((tc.overallScore * 0.6 + ai.overallScore * 0.4) * 100) / 100;

    return {
      overallScore,
      maxScore,
      strengths: ai.strengths,
      weaknesses: ai.weaknesses,
      recommendations: ai.recommendations,
      criteriaScores: {
        testcase: tc.overallScore,
        ai: ai.overallScore,
        ...(ai.criteriaScores ?? {}),
      },
      strategy: 'hybrid',
      raw: { testcase: tc.raw, ai: ai.raw },
    };
  }
}

@Injectable()
export class EvaluationProviderRegistry {
  constructor(
    private readonly testcase: TestCaseEvaluationProvider,
    private readonly ai: AiEvaluationProvider,
    private readonly hybrid: HybridEvaluationProvider,
  ) {}

  resolve(mode: string): EvaluationProvider {
    const providers = [this.hybrid, this.testcase, this.ai];
    return providers.find((p) => p.supports(mode)) ?? this.ai;
  }
}
