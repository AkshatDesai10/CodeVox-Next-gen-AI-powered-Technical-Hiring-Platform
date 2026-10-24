import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiClientService } from './openai-client.service';
import { JobProfileAiLogMysql } from '../../job-profiles/entities/job-profile-ai-log.mysql.entity';
import type { EvaluationContext, EvaluationResult } from '../shared/interfaces';
import { EvaluationStrategyType } from '../shared/enums';

type AiEvalJson = {
  score: number;
  maxScore: number;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  summary?: string;
};

@Injectable()
export class AiEvaluationService {
  constructor(
    private readonly openai: OpenAiClientService,
    @InjectRepository(JobProfileAiLogMysql)
    private readonly logRepo: Repository<JobProfileAiLogMysql>,
  ) {}

  async evaluate(ctx: EvaluationContext): Promise<EvaluationResult> {
    const maxScore = Number(ctx.marks) || 20;
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a senior technical interviewer. Score the candidate submission. Return JSON: score (0-maxScore), maxScore, strengths[], weaknesses[], recommendations[], summary.',
      },
      {
        role: 'user' as const,
        content: `Question: ${ctx.questionTitle}
Type: ${ctx.questionType}
Language: ${ctx.language}
Max score: ${maxScore}
Problem: ${ctx.problemDescription ?? 'N/A'}
Evaluation criteria: ${JSON.stringify(ctx.evaluationConfig ?? {})}

Candidate answer:
${ctx.sourceCode}`,
      },
    ];

    const detailed = await this.openai.chatJsonDetailed<AiEvalJson>(messages);
    const result = detailed.data;
    if ((result as Record<string, unknown> | undefined)?.__isFallback) {
      throw new ServiceUnavailableException('AI evaluation service is currently unavailable — no fallback score was accepted.');
    }
    const score = Math.min(Math.max(Number(result.score) || 0, 0), maxScore);

    await this.logRepo.save(
      this.logRepo.create({
        candidateAssessmentId: ctx.candidateAssessmentId,
        assessmentId: null,
        operation: 'evaluate_submission',
        model: detailed.model,
        promptHash: this.openai.promptHash(messages),
        requestJson: { questionId: ctx.questionId, messages },
        responseJson: result as unknown as Record<string, unknown>,
        promptTokens: detailed.usage.promptTokens,
        completionTokens: detailed.usage.completionTokens,
      }),
    );

    const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
    let status = 'FAILED';
    if (pct >= 100) status = 'PASSED';
    else if (pct >= 50) status = 'PARTIAL';

    return {
      score,
      maxScore,
      status,
      executionTime: 0,
      strategy: EvaluationStrategyType.AI,
      strengths: result.strengths ?? [],
      weaknesses: result.weaknesses ?? [],
      recommendations: result.recommendations ?? [],
      rubricJson: { summary: result.summary },
      percentage: pct,
      passedTests: 0,
      totalTests: 0,
    };
  }
}
