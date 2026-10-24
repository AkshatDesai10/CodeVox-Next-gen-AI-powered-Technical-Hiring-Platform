import type { GenerateFlags, SectionDefinition } from '../types';
import { SECTION_REGISTRY } from '../registry/section.registry';

export class SectionBuilder {
  constructor(
    private readonly generator: 'coding' | 'database',
    private readonly flags: GenerateFlags = {},
  ) {}

  isEnabled(section: SectionDefinition): boolean {
    if (!section.generators.includes(this.generator)) return false;
    const flagKey = section.id as keyof GenerateFlags;
    const flagValue = this.flags[flagKey];
    if (flagValue === false) return false;
    if (flagValue === true) return true;
    if (typeof section.defaultEnabled === 'function') return section.defaultEnabled(this.flags);
    if (typeof section.defaultEnabled === 'boolean') return section.defaultEnabled;
    return flagValue !== false;
  }

  enabledSections(): SectionDefinition[] {
    return SECTION_REGISTRY.filter((section) => this.isEnabled(section));
  }

  promptSectionLines(): string[] {
    return this.enabledSections().map((section) => section.promptLine);
  }

  promptSectionSummary(): string {
    const lines = this.promptSectionLines();
    return lines.length ? lines.join(', ') : 'all standard sections';
  }
}
