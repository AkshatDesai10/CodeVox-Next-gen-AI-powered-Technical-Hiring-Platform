import type { AiGenerationConfig } from '../types';
import { SectionBuilder } from '../builders/SectionBuilder';
import { JsonSchemaBuilder } from '../builders/JsonSchemaBuilder';

export function buildDatabaseSchema(config: Pick<AiGenerationConfig, 'generate'>) {
  const sections = new SectionBuilder('database', config.generate ?? {}).enabledSections();
  return new JsonSchemaBuilder().fromSections(sections).build();
}
