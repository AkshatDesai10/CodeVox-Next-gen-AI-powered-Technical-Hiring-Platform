import type { ProblemBankAiGenerateInput } from './types';
import { PromptBuilder } from './builders/PromptBuilder';
import { CODING_SYSTEM_PROMPT } from './prompts/system.prompt';
import { CODING_GENERATION_RULES } from './prompts/coding.prompt';

/** Backward-compatible user prompt builder for coding problems */
export function buildProblemBankAiUserPrompt(input: ProblemBankAiGenerateInput): string {
  const config = {
    generator: 'coding' as const,
    competency_name: input.competency_name ?? input.job_profile ?? input.topic_tag ?? 'Problem Solving',
    competency_description: input.competency_description,
    job_profile: input.job_profile,
    tech_stack: input.tech_stack,
    domain: input.domain,
    seniority: input.seniority,
    topic_tag: input.topic_tag,
    difficulty: input.difficulty,
    problem_pattern: input.problem_pattern,
    max_input_size: input.max_input_size,
    value_range: input.value_range,
    time_limit: input.time_limit,
    memory_limit: input.memory_limit,
    time_limit_ms: input.time_limit_ms,
    memory_limit_mb: input.memory_limit_mb,
    languages: input.languages,
    job_profile_id: input.job_profile_id,
    generate: input.generate,
  };
  return new PromptBuilder()
    .system(CODING_SYSTEM_PROMPT)
    .configuration(config)
    .rules(CODING_GENERATION_RULES)
    .build().user;
}
