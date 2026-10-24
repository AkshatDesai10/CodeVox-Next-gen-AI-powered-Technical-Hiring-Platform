import type { GenericQuestion } from '@/types/assessment-engine';
import {
  extractCodeBlocks,
  extractStarterCodeFromText,
  pickStarterCodeBlock,
  stripCodeFences,
} from './code-block.util';
import { formatTestCaseField } from './format-test-case';

export { extractCodeBlocks, extractStarterCodeFromText, pickStarterCodeBlock, stripCodeFences };

export type DisplayTestCase = {
  input: string;
  expectedOutput?: string;
  isHidden?: boolean;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

export function getQuestionPrompt(question: GenericQuestion): string {
  const json = question.questionJson ?? {};
  const isMcq = question.questionType?.toUpperCase() === 'MCQ';
  const parts = (isMcq
    ? [json.question, json.prompt, question.description, json.scenario, json.problemStatement]
    : [question.description, json.prompt, json.question, json.scenario, json.problemStatement]
  )
    .map((p) => (p != null ? String(p).trim() : ''))
    .filter(Boolean);
  return parts[0] ?? '';
}

/** Problem text for the side panel - code blocks shown in the editor instead. */
export function getQuestionPromptForDisplay(question: GenericQuestion): string {
  const full = getQuestionPrompt(question);
  const withoutCode = stripCodeFences(full);
  return withoutCode || full;
}

export function getQuestionConstraints(question: GenericQuestion): string[] {
  return asStringArray(question.questionJson?.constraints);
}

export function getQuestionRequirements(question: GenericQuestion): string[] {
  return asStringArray(question.questionJson?.requirements);
}

export function getFollowUpQuestions(question: GenericQuestion): string[] {
  return asStringArray(question.questionJson?.followUpQuestions);
}

export function getMcqOptions(question: GenericQuestion): Array<{ label: string; text: string }> {
  const extended = question as GenericQuestion & {
    mcqOptions?: Array<{ label?: string; text?: string }>;
  };
  if (Array.isArray(extended.mcqOptions) && extended.mcqOptions.length) {
    return extended.mcqOptions.map((opt) => ({
      label: String(opt.label ?? ''),
      text: String(opt.text ?? ''),
    }));
  }

  const raw = question.questionJson?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((opt) => {
      const row = opt as Record<string, unknown>;
      return {
        label: String(row.label ?? row.key ?? ''),
        text: String(row.text ?? row.option ?? row.value ?? ''),
      };
    })
    .filter((opt) => opt.label || opt.text);
}

export function getVisibleTestCases(question: GenericQuestion): DisplayTestCase[] {
  const jsonCases = question.questionJson?.testCases;
  const evalCases =
    (question as { evaluationConfig?: { testCases?: unknown } }).evaluationConfig?.testCases ??
    question.questionJson?.testCases;

  const source = Array.isArray(jsonCases) ? jsonCases : Array.isArray(evalCases) ? evalCases : [];
  return source
    .map((tc) => {
      const row = tc as Record<string, unknown>;
      return {
        input: formatTestCaseField(row.input, 'input'),
        expectedOutput: (() => {
          const formatted = formatTestCaseField(
            row.expectedOutput ?? row.expected_output,
            'output',
          );
          return formatted || undefined;
        })(),
        isHidden: Boolean(row.isHidden ?? row.is_hidden),
      };
    })
    .filter((tc) => tc.input || tc.expectedOutput);
}

export function getSampleTestCases(question: GenericQuestion): DisplayTestCase[] {
  const cases = getVisibleTestCases(question);
  const samples = cases.filter((tc) => !tc.isHidden);
  return samples.length ? samples : cases.slice(0, 2);
}

export function getSqlSchemaHint(question: GenericQuestion): string | null {
  const json = question.questionJson ?? {};
  const env = (question as { environmentConfig?: Record<string, unknown> }).environmentConfig;
  const envTemplate = json.environmentTemplate as Record<string, unknown> | undefined;
  const schema =
    json.schema ??
    json.databaseSchema ??
    json.seedData ??
    env?.seedData ??
    env?.schema ??
    envTemplate?.seedData ??
    envTemplate?.schema;

  if (schema && typeof schema === 'string' && schema.trim()) return schema.trim();
  if (schema && typeof schema === 'object') return JSON.stringify(schema, null, 2);

  const prompt = getQuestionPrompt(question);
  const blocks = extractCodeBlocks(prompt);
  const ddlBlocks = blocks.filter((b) => /^(CREATE\s+TABLE|INSERT\s+INTO|--)/im.test(b));
  if (ddlBlocks.length) return ddlBlocks.join('\n\n');

  const createTable = blocks.find((b: string) => /^CREATE\s+TABLE/im.test(b));
  if (createTable) return createTable;

  if (question.language?.toUpperCase() === 'SQL' || question.questionType?.toUpperCase() === 'CODING') {
    const firstInput = getSampleTestCases(question)[0]?.input;
    if (firstInput && /^(CREATE|INSERT|--)/im.test(firstInput)) return firstInput;
  }
  return null;
}

export function hasDatabaseSchema(question: GenericQuestion): boolean {
  return Boolean(getSqlSchemaHint(question));
}

export function getStarterCode(question: GenericQuestion): string {
  const json = question.questionJson ?? {};
  for (const key of ['starterCode', 'buggyCode', 'code', 'template', 'initialCode']) {
    const val = json[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }

  const fromText = extractStarterCodeFromText(getQuestionPrompt(question), question.language);
  if (fromText) return fromText;

  return '';
}
