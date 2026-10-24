import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiClientService } from './openai-client.service';
import { JobProfileAiLogMysql } from '../../job-profiles/entities/job-profile-ai-log.mysql.entity';
import {
  SINGLE_QUESTION_SYSTEM_PROMPT,
  buildInterviewBatchUserPrompt,
  buildSingleQuestionUserPrompt,
  interviewBatchSystemPrompt,
  type QuestionPromptProfile,
} from '../assessment-engine/utils/assessment-generation-prompt.util';

export type GenerateQuestionInput = {
  candidateAssessmentId?: string;
  assessmentId?: string;
  skills: string[];
  experienceLevel: string;
  difficulty: string;
  targetSkills?: string[];
  count?: number;
  roleTitle?: string;
  responsibilities?: string[];
  questionIndex?: number;
  totalCount?: number;
  priorQuestions?: string[];
  excludePrompts?: string[];
  questionType?: string;
  roundPromptLines?: string[];
  promptProfile?: QuestionPromptProfile;
  focusThemes?: string[];
  skipLog?: boolean;
};

export type GenerateFromPromptInput = {
  prompt: string;
  assessmentId?: string;
  candidateAssessmentId?: string;
  skills?: string[];
  experienceLevel?: string;
  difficulty?: string;
  questionType?: string;
};

export type GeneratedQuestionPayload = {
  title: string;
  problemStatement: string;
  requirements: string[];
  expectedSkills: string[];
  evaluationCriteria: string[];
  environmentTemplate: Record<string, unknown>;
  questionType?: string;
  language?: string;
  difficulty?: string;
  marks?: number;
  testCases?: Array<{ input: string; expectedOutput: string; isHidden?: boolean }>;
  starterCode?: string;
  buggyCode?: string;
  code?: string;
  options?: Array<{ label: string; text: string; isCorrect: boolean }>;
};

function normalizePromptKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

@Injectable()
export class AiQuestionGeneratorService {
  private readonly logger = new Logger(AiQuestionGeneratorService.name);

  constructor(
    private readonly openai: OpenAiClientService,
    @InjectRepository(JobProfileAiLogMysql)
    private readonly logRepo: Repository<JobProfileAiLogMysql>,
  ) {}

  private isNonTechnicalProfile(profile: QuestionPromptProfile): boolean {
    return profile === 'screening' || profile === 'behavioral' || profile === 'hr_panel';
  }

  private async persistLog(
    operation: string,
    input: Pick<GenerateQuestionInput, 'candidateAssessmentId' | 'assessmentId'>,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    response: unknown,
    usage?: { promptTokens: number | null; completionTokens: number | null },
    model?: string,
  ) {
    try {
      await this.logRepo.save(
        this.logRepo.create({
          candidateAssessmentId: input.candidateAssessmentId ?? null,
          assessmentId: input.assessmentId ?? null,
          operation,
          model: model ?? this.openai.activeModel(),
          promptHash: this.openai.promptHash(messages),
          requestJson: { messages },
          responseJson: response as Record<string, unknown>,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          inactive: 0,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to persist ${operation} AI log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async generateOne(input: GenerateQuestionInput): Promise<GeneratedQuestionPayload> {
    const profile = input.promptProfile ?? 'technical';
    const isNonTechnical = this.isNonTechnicalProfile(profile);
    const themes = input.focusThemes ?? [];
    const skills = isNonTechnical
      ? themes
      : [...(input.targetSkills ?? []), ...input.skills].filter(Boolean);
    const index = input.questionIndex ?? 0;
    const total = input.totalCount ?? 1;
    const focusSkill = isNonTechnical
      ? themes[index % Math.max(themes.length, 1)] ?? themes[0] ?? 'communication and role fit'
      : skills[index % Math.max(skills.length, 1)] ?? skills[0] ?? 'General software engineering';
    const prior = [...(input.priorQuestions ?? []), ...(input.excludePrompts ?? [])].filter(Boolean);
    const roundLines = input.roundPromptLines ?? [];

    const systemPrompt =
      profile === 'screening' || profile === 'behavioral' || profile === 'hr_panel'
        ? interviewBatchSystemPrompt(profile)
        : SINGLE_QUESTION_SYSTEM_PROMPT;

    const messages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      {
        role: 'user' as const,
        content: buildSingleQuestionUserPrompt({
          prompt: [
            ...roundLines,
            `Role context (do not make questions deeply technical unless this is a technical round): ${input.roleTitle ?? 'Hire'}`,
            `Generate interview question ${index + 1} of ${total}.`,
            isNonTechnical
              ? `Primary theme for this question: ${focusSkill}.`
              : `Primary focus for this question: ${focusSkill}.`,
            input.responsibilities?.length && !isNonTechnical
              ? `Role context: ${input.responsibilities.slice(0, 4).join('; ')}`
              : null,
            prior.length
              ? `Must be materially different from these existing questions: ${prior.join(' | ')}`
              : 'Must be unique and not generic.',
          ]
            .filter(Boolean)
            .join('\n'),
          experienceLevel: input.experienceLevel,
          difficulty: input.difficulty,
          questionType: isNonTechnical ? 'INTERVIEW' : input.questionType,
          skills: isNonTechnical ? themes : skills,
          promptProfile: profile,
        }),
      },
    ];

    const detailed = await this.openai.chatJsonDetailed<GeneratedQuestionPayload>(messages);
    const payload = detailed.data;
    if ((payload as Record<string, unknown> | undefined)?.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — question generation cannot be performed.');
    }

    // Always persist token usage for the real LLM call. `skipLog` only suppresses
    // aggregate batch summary rows (see generateBatchParallel), not per-call rows.
    await this.persistLog(
      'generate_question',
      input,
      messages,
      payload,
      detailed.usage,
      detailed.model,
    );

    return payload;
  }

  private async generateInterviewBatchOneCall(
    input: GenerateQuestionInput,
    count: number,
  ): Promise<GeneratedQuestionPayload[]> {
    const profile = input.promptProfile ?? 'screening';
    const messages = [
      {
        role: 'system' as const,
        content: interviewBatchSystemPrompt(profile),
      },
      {
        role: 'user' as const,
        content: buildInterviewBatchUserPrompt({
          count,
          roundPromptLines: input.roundPromptLines,
          roleTitle: input.roleTitle,
          experienceLevel: input.experienceLevel,
          difficulty: input.difficulty,
          themes: input.focusThemes,
          excludePrompts: [...(input.excludePrompts ?? []), ...(input.priorQuestions ?? [])],
          promptProfile: profile,
        }),
      },
    ];

    const detailed = await this.openai.chatJsonDetailed<{ questions?: GeneratedQuestionPayload[] }>(messages);
    const payload = detailed.data;
    if ((payload as Record<string, unknown> | undefined)?.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — batch question generation cannot be performed.');
    }
    const items = (payload.questions ?? []).filter((q) => q.problemStatement?.trim() || q.title?.trim());

    // Always store tokens for the real batch LLM call.
    await this.persistLog(
      'generate_question_batch',
      input,
      messages,
      payload,
      detailed.usage,
      detailed.model,
    );

    return items;
  }

  private async generateBatchParallel(
    input: GenerateQuestionInput,
    count: number,
    seen: Set<string>,
  ): Promise<GeneratedQuestionPayload[]> {
    // Each generateOne persists its own token usage to job_profile_ai_logs.
    const payloads = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.generateOne({
          ...input,
          count: 1,
          questionIndex: i,
          totalCount: count,
          priorQuestions: [
            ...(input.priorQuestions ?? []),
            ...(input.excludePrompts ?? []),
          ],
        }),
      ),
    );

    const results: GeneratedQuestionPayload[] = [];
    for (const payload of payloads) {
      const key = normalizePromptKey(payload.problemStatement || payload.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(payload);
    }

    return results;
  }

  private dedupeResults(
    items: GeneratedQuestionPayload[],
    seen: Set<string>,
    limit: number,
  ): GeneratedQuestionPayload[] {
    const results: GeneratedQuestionPayload[] = [];
    for (const payload of items) {
      const key = normalizePromptKey(payload.problemStatement || payload.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(payload);
      if (results.length >= limit) break;
    }
    return results;
  }

  async generateBatch(input: GenerateQuestionInput): Promise<GeneratedQuestionPayload[]> {
    const count = Math.min(Math.max(input.count ?? 3, 1), 8);
    const profile = input.promptProfile ?? 'technical';
    const seen = new Set(
      (input.excludePrompts ?? []).map((p) => normalizePromptKey(p)).filter(Boolean),
    );

    if (count === 1) {
      const single = await this.generateOne({ ...input, count: 1, questionIndex: 0, totalCount: 1 });
      return this.dedupeResults([single], seen, 1);
    }

    if (this.isNonTechnicalProfile(profile)) {
      try {
        const batch = await this.generateInterviewBatchOneCall(input, count);
        const deduped = this.dedupeResults(batch, seen, count);
        if (deduped.length >= count) return deduped.slice(0, count);

        const shortfall = count - deduped.length;
        if (shortfall > 0) {
          const extra = await this.generateBatchParallel(
            {
              ...input,
              priorQuestions: [
                ...(input.priorQuestions ?? []),
                ...deduped.map((q) => q.problemStatement || q.title),
              ],
            },
            shortfall,
            seen,
          );
          return [...deduped, ...extra].slice(0, count);
        }
        return deduped;
      } catch (error) {
        this.logger.warn(
          `Interview batch one-call failed (${(error as Error).message}); falling back to parallel generation`,
        );
        return this.generateBatchParallel(input, count, seen);
      }
    }

    return this.generateBatchParallel(input, count, seen);
  }

  async generateFromPrompt(input: GenerateFromPromptInput): Promise<GeneratedQuestionPayload> {
    const messages = [
      {
        role: 'system' as const,
        content: SINGLE_QUESTION_SYSTEM_PROMPT,
      },
      {
        role: 'user' as const,
        content: buildSingleQuestionUserPrompt({
          prompt: input.prompt,
          experienceLevel: input.experienceLevel,
          difficulty: input.difficulty,
          questionType: input.questionType,
          skills: input.skills,
        }),
      },
    ];

    const detailed = await this.openai.chatJsonDetailed<GeneratedQuestionPayload>(messages);
    const payload = detailed.data;
    if ((payload as Record<string, unknown> | undefined)?.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — prompt-based question generation cannot be performed.');
    }

    await this.persistLog('generate_question_prompt', input, messages, payload, detailed.usage, detailed.model);

    return payload;
  }
}
