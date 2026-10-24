import type { SectionDefinition } from '../types';
import { CODING_SECTIONS } from './coding.sections';
import { DATABASE_SECTIONS } from './database.sections';

export const SECTION_REGISTRY: SectionDefinition[] = [...CODING_SECTIONS, ...DATABASE_SECTIONS];

export function sectionsForGenerator(generator: 'coding' | 'database') {
  return SECTION_REGISTRY.filter((section) => section.generators.includes(generator));
}
