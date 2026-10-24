import type { AiGenerationConfig } from '../types';

export function formatConfigurationBlock(config: AiGenerationConfig): string {
  const languages = config.languages.length ? config.languages.join(', ') : 'javascript';
  const lines = [
    'INPUT CONFIGURATION',
    `Job Profile / Role: ${config.job_profile}`,
    `Competency: ${config.competency_name}`,
    config.competency_description?.trim()
      ? `Competency Description: ${config.competency_description.trim()}`
      : null,
    `Technology Stack: ${config.tech_stack}`,
    `Domain: ${config.domain}`,
    `Seniority: ${config.seniority}`,
    `Topic Tag: ${config.topic_tag}`,
    `Difficulty: ${config.difficulty}`,
  ].filter((line): line is string => Boolean(line));

  if (config.generator === 'coding') {
    lines.push(
      `Problem Pattern: ${config.problem_pattern ?? 'General Challenge'}`,
      `Requires Sandbox Database: ${config.requires_sandbox_database ? 'yes' : 'no'}`,
      `Maximum Input Size: ${config.max_input_size ?? '1 ≤ n ≤ 10^5'}`,
      `Value Range: ${config.value_range ?? '1 ≤ val ≤ 10^9'}`,
      `Time Limit: ${config.time_limit ?? '2000 ms'}`,
      `Memory Limit: ${config.memory_limit ?? '256 MB'}`,
      `Supported Languages: ${languages}`,
    );
  } else {
    lines.push(
      `Problem Pattern: ${config.problem_pattern ?? 'Schema Design'}`,
      `Database Type: ${config.database_type ?? 'MySQL'}`,
      `Seed Size: ${config.seed_options?.size ?? 'medium'}`,
      `Random Seed: ${config.seed_options?.random_seed ?? 42}`,
    );
  }

  return lines.join('\n');
}
