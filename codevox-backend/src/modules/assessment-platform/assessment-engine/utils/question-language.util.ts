import type { GeneratedQuestionPayload } from '../types/assessment-bundle.types';

const WORKSPACE_LANGUAGE: Record<string, string> = {
  php: 'PHP',
  python: 'PYTHON',
  node: 'NODE',
  sql: 'SQL',
  none: 'TEXT',
};

const ROLE_DEFAULT_LANGUAGE: Array<{ pattern: RegExp; language: string }> = [
  { pattern: /laravel|php/i, language: 'PHP' },
  { pattern: /python/i, language: 'PYTHON' },
  { pattern: /react|node|javascript|typescript/i, language: 'NODE' },
  { pattern: /sql|mysql|dba|data engineer/i, language: 'SQL' },
  { pattern: /redis/i, language: 'NODE' },
  { pattern: /aws|architect|devops|qa|solution/i, language: 'TEXT' },
];

export function resolveQuestionLanguage(
  question: GeneratedQuestionPayload,
  role: string,
): string {
  const candidates = [
    question.language,
    question.questionJson?.language,
    question.questionJson?.detectedLanguage,
    question.questionJson?.codingLanguage,
    question.questionJson?.primaryLanguage,
  ];

  for (const raw of candidates) {
    const val = String(raw ?? '').trim().toUpperCase();
    if (val && ['PHP', 'PYTHON', 'NODE', 'SQL', 'TEXT'].includes(val)) {
      return val;
    }
  }

  const ws = String(question.workspaceType ?? '').toLowerCase();
  if (ws && WORKSPACE_LANGUAGE[ws]) return WORKSPACE_LANGUAGE[ws];

  if (question.questionType?.toUpperCase() === 'CODING' && ws) {
    const mapped = WORKSPACE_LANGUAGE[ws];
    if (mapped) return mapped;
  }

  if (question.questionType?.toUpperCase() === 'SYSTEM_DESIGN') return 'TEXT';
  if (question.questionType?.toUpperCase() === 'INTERVIEW') return 'TEXT';
  if (question.questionType?.toUpperCase() === 'MCQ') return 'TEXT';

  for (const rule of ROLE_DEFAULT_LANGUAGE) {
    if (rule.pattern.test(role)) return rule.language;
  }

  return 'TEXT';
}

export function applyLanguagesToBundle(
  questions: GeneratedQuestionPayload[],
  role: string,
): GeneratedQuestionPayload[] {
  return questions.map((q) => {
    const language = resolveQuestionLanguage(q, role);
    return {
      ...q,
      language,
      workspaceType: q.workspaceType ?? languageToWorkspace(language),
      questionJson: {
        ...q.questionJson,
        language,
      },
    };
  });
}

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
