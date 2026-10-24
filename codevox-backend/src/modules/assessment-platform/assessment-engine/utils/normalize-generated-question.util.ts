import type { GeneratedQuestionPayload } from '../types/assessment-bundle.types';
import { resolveQuestionLanguage } from './question-language.util';

const VALID_TYPES = ['CODING', 'MCQ', 'SHORT_ANSWER', 'SYSTEM_DESIGN', 'INTERVIEW'] as const;

const DEFAULT_EVALUATION: Record<string, 'TESTCASE' | 'AI' | 'HYBRID'> = {
  CODING: 'TESTCASE',
  MCQ: 'AI',
  SHORT_ANSWER: 'AI',
  SYSTEM_DESIGN: 'AI',
  INTERVIEW: 'AI',
};

function languageToWorkspace(language: string): string {
  switch (language.toUpperCase()) {
    case 'PHP':
      return 'php';
    case 'PYTHON':
      return 'python';
    case 'NODE':
      return 'node';
    case 'SQL':
      return 'sql';
    default:
      return 'none';
  }
}

function normalizeQuestionType(raw?: string): string {
  const t = (raw ?? 'SHORT_ANSWER').toUpperCase().replace(/\s+/g, '_');
  return VALID_TYPES.includes(t as (typeof VALID_TYPES)[number]) ? t : 'SHORT_ANSWER';
}

function readLanguageFromPayload(q: GeneratedQuestionPayload): string | undefined {
  const top = q.language?.trim().toUpperCase();
  if (top && ['PHP', 'PYTHON', 'NODE', 'SQL', 'TEXT'].includes(top)) return top;

  const json = q.questionJson ?? {};
  for (const key of ['language', 'detectedLanguage', 'codingLanguage', 'primaryLanguage']) {
    const val = String(json[key] ?? '').trim().toUpperCase();
    if (val && ['PHP', 'PYTHON', 'NODE', 'SQL', 'TEXT'].includes(val)) return val;
  }
  return undefined;
}

function ensureQuestionJson(
  questionType: string,
  description: string | undefined,
  questionJson: Record<string, unknown>,
  language: string,
): Record<string, unknown> {
  const base = { ...questionJson };

  switch (questionType) {
    case 'CODING':
      return {
        prompt: base.prompt ?? description ?? '',
        constraints: Array.isArray(base.constraints) ? base.constraints : [],
        starterCode: typeof base.starterCode === 'string' ? base.starterCode : '',
        testCases: Array.isArray(base.testCases) ? base.testCases : [],
        ...base,
        language,
      };
    case 'MCQ':
      return {
        question: base.question ?? description ?? '',
        options: Array.isArray(base.options) ? base.options : [],
        explanation: base.explanation ?? '',
        ...base,
        language,
      };
    case 'SHORT_ANSWER':
      return {
        prompt: base.prompt ?? description ?? '',
        expectedKeywords: Array.isArray(base.expectedKeywords) ? base.expectedKeywords : [],
        sampleAnswer: base.sampleAnswer ?? '',
        ...base,
        language,
      };
    case 'SYSTEM_DESIGN':
      return {
        scenario: base.scenario ?? description ?? '',
        requirements: Array.isArray(base.requirements) ? base.requirements : [],
        evaluationCriteria: Array.isArray(base.evaluationCriteria) ? base.evaluationCriteria : [],
        ...base,
        language,
      };
    case 'INTERVIEW':
      return {
        prompt: base.prompt ?? description ?? '',
        followUpQuestions: Array.isArray(base.followUpQuestions) ? base.followUpQuestions : [],
        evaluationCriteria: Array.isArray(base.evaluationCriteria) ? base.evaluationCriteria : [],
        ...base,
        language,
      };
    default:
      return { ...base, language };
  }
}

export function normalizeGeneratedQuestion(
  raw: Partial<GeneratedQuestionPayload>,
  index: number,
  role: string,
  defaultDifficulty: string,
): GeneratedQuestionPayload {
  const questionType = normalizeQuestionType(raw.questionType);
  const draft: GeneratedQuestionPayload = {
    questionType,
    title: raw.title?.trim() || `Question ${index + 1}`,
    description: raw.description?.trim(),
    questionJson: raw.questionJson ?? {},
    workspaceType: raw.workspaceType,
    evaluationMode: raw.evaluationMode ?? DEFAULT_EVALUATION[questionType] ?? 'AI',
    difficulty: (raw.difficulty ?? defaultDifficulty).toUpperCase(),
    estimatedDuration: raw.estimatedDuration ?? 30,
    marks: raw.marks ?? 20,
    mandatory: raw.mandatory !== false,
    sortOrder: raw.sortOrder ?? index + 1,
    language: readLanguageFromPayload(raw as GeneratedQuestionPayload),
  };

  const language = resolveQuestionLanguage(draft, role);
  const workspaceType = draft.workspaceType ?? languageToWorkspace(language);
  const evaluationMode =
    draft.evaluationMode ??
    DEFAULT_EVALUATION[questionType] ??
    (questionType === 'CODING' ? 'TESTCASE' : 'AI');

  return {
    ...draft,
    language,
    workspaceType,
    evaluationMode,
    questionJson: ensureQuestionJson(
      questionType,
      draft.description,
      draft.questionJson,
      language,
    ),
  };
}
