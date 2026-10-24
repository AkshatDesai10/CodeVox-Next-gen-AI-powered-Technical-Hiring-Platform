export type {
  AiGenerationConfig,
  GenerateFlags,
  GeneratorType,
  ProblemBankAiGenerateInput,
  SeedOptions,
  SeedSize,
  SectionDefinition,
} from './types';

export { PromptBuilder } from './builders/PromptBuilder';
export { JsonSchemaBuilder, buildSchemaFromSections } from './builders/JsonSchemaBuilder';
export {
  MarkdownBuilder,
  composeCodingStatementMarkdown,
  composeDatabaseStatementMarkdown,
  composeCodingStatementMarkdown as composeProblemStatementMarkdown,
} from './builders/MarkdownBuilder';
export { SectionBuilder } from './builders/SectionBuilder';
export { SECTION_REGISTRY, sectionsForGenerator } from './registry/section.registry';
export {
  getGenerator,
  registerGenerator,
  runGenerator,
  CodingGenerator,
  DatabaseGenerator,
  type AiGenerator,
  type GeneratorContext,
} from './generators/generator.registry';
export { CODING_SYSTEM_PROMPT, DATABASE_SYSTEM_PROMPT, PROBLEM_BANK_AI_SYSTEM_PROMPT } from './prompts/system.prompt';
export { buildProblemBankAiUserPrompt } from './build-problem-bank-prompt';

import type { AiGenerationConfig } from './types';
import { SectionBuilder } from './builders/SectionBuilder';
import { JsonSchemaBuilder } from './builders/JsonSchemaBuilder';

export function buildCodingSchemaFromConfig(input: Pick<AiGenerationConfig, 'generate'>) {
  const sections = new SectionBuilder('coding', input.generate ?? {}).enabledSections();
  return new JsonSchemaBuilder().fromSections(sections).build();
}

export function buildDatabaseSchemaFromConfig(input: Pick<AiGenerationConfig, 'generate'>) {
  const sections = new SectionBuilder('database', input.generate ?? {}).enabledSections();
  return new JsonSchemaBuilder().fromSections(sections).build();
}
