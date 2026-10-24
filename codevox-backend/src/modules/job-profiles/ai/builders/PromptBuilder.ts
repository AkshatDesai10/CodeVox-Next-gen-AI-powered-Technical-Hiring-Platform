import type { AiGenerationConfig, BuiltPrompt } from '../types';
import { SectionBuilder } from './SectionBuilder';
import { JsonSchemaBuilder } from './JsonSchemaBuilder';
import { CODING_GENERATION_RULES } from '../prompts/coding.prompt';
import { DATABASE_GENERATION_RULES } from '../prompts/database.prompt';
import { SENIORITY_CALIBRATION_PROMPT } from '../prompts/calibration.prompt';
import { PATTERN_GUIDANCE_PROMPT } from '../prompts/pattern.prompt';
import { CODING_VALIDATION_PROMPT, DATABASE_VALIDATION_PROMPT } from '../prompts/validation.prompt';
import { formatConfigurationBlock } from '../templates/configuration.template';

export class PromptBuilder {
  private systemContent = '';
  private config: AiGenerationConfig | null = null;
  private ruleBlocks: string[] = [];
  private extraBlocks: string[] = [];
  private footer = '';

  system(content: string) {
    this.systemContent = content;
    return this;
  }

  configuration(config: AiGenerationConfig) {
    this.config = config;
    return this;
  }

  rules(...blocks: string[]) {
    this.ruleBlocks.push(...blocks.filter(Boolean));
    return this;
  }

  block(content: string) {
    if (content.trim()) this.extraBlocks.push(content.trim());
    return this;
  }

  validationFooter(content: string) {
    this.footer = content;
    return this;
  }

  build(): BuiltPrompt {
    if (!this.config) throw new Error('PromptBuilder requires configuration');
    const config = this.config;
    const sectionBuilder = new SectionBuilder(config.generator, config.generate ?? {});
    const enabled = sectionBuilder.enabledSections();
    const schemaJson = new JsonSchemaBuilder().fromSections(enabled).toPromptJson();

    const intro =
      config.generator === 'database'
        ? 'Generate a complete SQL/database assessment dataset based on the following configuration.'
        : 'Generate a complete coding assessment based on the following configuration.';

    const skeletonInstruction = config.generator === 'coding'
      ? `CRITICAL STARTER CODE RULES:
1. Our platform uses Standard I/O (STDIN/STDOUT).
2. The \`starterCode\` MUST be a template for the candidate. It MUST NOT contain the actual solution algorithm. Leave the function body EMPTY except for a // TODO comment.
3. At the bottom of \`starterCode\`, provide the complete boilerplate to read stdin, parse it, call the empty function, and print the result.
4. The input parsing in the boilerplate MUST exactly match the format of your test cases.
5. Generate \`starterCode\` for ONLY these languages: ${config.languages.join(', ')}.`
      : '';

    const userParts = [
      intro,
      '',
      formatConfigurationBlock(config),
      '',
      skeletonInstruction,
      '',
      'GENERATION RULES',
      'CRITICAL: Your entire response must be valid JSON. Do NOT use JavaScript expressions (like `"a" + "b"` or `str.repeat()`) inside JSON strings. If a test case is large, provide a smaller representative example instead of using string multipliers.',
      ...(this.ruleBlocks.length
        ? this.ruleBlocks
        : config.generator === 'database'
          ? [DATABASE_GENERATION_RULES]
          : [CODING_GENERATION_RULES]),
      '',
      ...(config.custom_instructions
        ? [
            'CUSTOM INSTRUCTIONS FROM USER:',
            'You MUST adhere to the following custom instructions provided by the recruiter/hiring manager:',
            `"""\n${config.custom_instructions}\n"""`,
            '',
          ]
        : []),
      `Produce these sections in your JSON response: ${sectionBuilder.promptSectionSummary()}.`,
      '',
      SENIORITY_CALIBRATION_PROMPT,
      '',
      ...(config.generator === 'coding' ? [PATTERN_GUIDANCE_PROMPT, ''] : []),
      ...this.extraBlocks,
      'RETURN FORMAT — strict JSON only:',
      schemaJson,
      '',
      this.footer ||
        (config.generator === 'database' ? DATABASE_VALIDATION_PROMPT : CODING_VALIDATION_PROMPT),
    ];

    return {
      system: this.systemContent,
      user: userParts.filter((line) => line !== undefined).join('\n'),
    };
  }
}
