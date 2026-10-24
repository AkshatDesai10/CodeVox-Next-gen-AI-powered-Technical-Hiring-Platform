import type { ChatMessage } from '../../../assessment-platform/assessment-ai/openai-client.service';
import type { AiGenerationConfig, BuiltPrompt, GeneratorType } from '../types';
import { PromptBuilder } from '../builders/PromptBuilder';
import { CODING_SYSTEM_PROMPT, DATABASE_SYSTEM_PROMPT, SIMPLE_DATABASE_SYSTEM_PROMPT } from '../prompts/system.prompt';
import { CODING_GENERATION_RULES } from '../prompts/coding.prompt';
import { DATABASE_GENERATION_RULES, SIMPLE_DATABASE_GENERATION_RULES } from '../prompts/database.prompt';
import { buildCodingFallbackRaw, mapCodingAiResult, ensureCodingRaw, normalizeCodingAiRaw } from '../mappers/coding.mapper';
import { buildDatabaseFallbackRaw, mapDatabaseAiResult, mapSimpleSqlAiResult, ensureDatabaseRaw, normalizeDatabaseAiRaw } from '../mappers/database.mapper';

export type GeneratorContext = {
  isAiConfigured: boolean;
  chatJson: <T>(messages: ChatMessage[]) => Promise<T>;
};

export interface AiGenerator {
  readonly type: GeneratorType;
  buildPrompt(config: AiGenerationConfig): BuiltPrompt;
  fallback(config: AiGenerationConfig): Record<string, unknown>;
  mapResult(raw: Record<string, unknown>, config: AiGenerationConfig): Record<string, unknown>;
}

export const CODING_SANDBOX_DATABASE_RULES = `SANDBOX DATABASE (when requires_sandbox_database is true):
- The candidate writes code (not SQL answers) that reads/writes the pre-loaded sandbox database.
- database_schema.ddl_sql must create every table the solution queries.
- seed_data.insert_sql must populate realistic rows so all test cases pass when the solution runs against the sandbox.
- Starter code may include a DB connection helper; the platform applies DDL and seed before execution.
- Keep table and column names consistent across statement, schema, seed, starter code, solution, and test cases.`;

export class CodingGenerator implements AiGenerator {
  readonly type = 'coding' as const;

  buildPrompt(config: AiGenerationConfig): BuiltPrompt {
    const builder = new PromptBuilder()
      .system(CODING_SYSTEM_PROMPT)
      .configuration(config)
      .rules(CODING_GENERATION_RULES);
    if (config.requires_sandbox_database) {
      builder.rules(CODING_SANDBOX_DATABASE_RULES);
    }
    return builder.build();
  }

  fallback(config: AiGenerationConfig) {
    return buildCodingFallbackRaw(config);
  }

  mapResult(raw: Record<string, unknown>, config: AiGenerationConfig) {
    return mapCodingAiResult(raw, config, config.generate);
  }
}

export class DatabaseGenerator implements AiGenerator {
  readonly type = 'database' as const;

  buildPrompt(config: AiGenerationConfig): BuiltPrompt {
    if (config.database_question_type === 'simple') {
      return new PromptBuilder()
        .system(SIMPLE_DATABASE_SYSTEM_PROMPT)
        .configuration({ ...config, generator: 'database' })
        .rules(SIMPLE_DATABASE_GENERATION_RULES)
        .build();
    }
    // Default: scenario-based
    return new PromptBuilder()
      .system(DATABASE_SYSTEM_PROMPT)
      .configuration({ ...config, generator: 'database' })
      .rules(DATABASE_GENERATION_RULES)
      .build();
  }

  fallback(config: AiGenerationConfig) {
    return buildDatabaseFallbackRaw(config);
  }

  mapResult(raw: Record<string, unknown>, config: AiGenerationConfig) {
    if (config.database_question_type === 'simple') {
      return mapSimpleSqlAiResult(raw, config);
    }
    return mapDatabaseAiResult(raw, config, config.generate);
  }
}

const GENERATORS: Record<GeneratorType, AiGenerator> = {
  coding: new CodingGenerator(),
  database: new DatabaseGenerator(),
};

export function getGenerator(type: GeneratorType): AiGenerator {
  const generator = GENERATORS[type];
  if (!generator) throw new Error(`Unknown generator type: ${type}`);
  return generator;
}

export function registerGenerator(type: GeneratorType, generator: AiGenerator) {
  GENERATORS[type] = generator;
}

export async function runGenerator(
  type: GeneratorType,
  config: AiGenerationConfig,
  ctx: GeneratorContext,
) {
  const generator = getGenerator(type);
  const prompt = generator.buildPrompt(config);
  const fallbackRaw = generator.fallback(config);
  let raw: Record<string, unknown>;
  let aiPowered = ctx.isAiConfigured;

  if (ctx.isAiConfigured) {
    raw = await ctx.chatJson<Record<string, unknown>>([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ]);
    raw =
      type === 'coding'
        ? ensureCodingRaw(raw, fallbackRaw, config.languages)
        : ensureDatabaseRaw(raw, fallbackRaw);
  } else {
    raw = fallbackRaw;
    raw =
      type === 'coding'
        ? normalizeCodingAiRaw(raw, config.languages)
        : normalizeDatabaseAiRaw(raw);
  }

  const draft = generator.mapResult(raw, config);
  return { draft, raw, prompt, ai_powered: aiPowered };
}
