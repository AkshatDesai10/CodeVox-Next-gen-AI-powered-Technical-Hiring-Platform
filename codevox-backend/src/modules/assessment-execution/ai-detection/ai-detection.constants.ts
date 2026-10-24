import { QuestionType } from '../question-type.enum';

export type AiDetectionJobPayload = {
  candidateId: string;
  candidateAssessmentId: string;
  questionId: string;
  language: string;
  sourceCode: string;
  questionType: string;
};

/** Question types that receive HF AI detection + evaluation on final submit. */
export const AI_ANALYZABLE_QUESTION_TYPES = new Set<string>([
  QuestionType.CODING,
  QuestionType.SHORT_ANSWER,
  QuestionType.SYSTEM_DESIGN,
]);

/** Map submission language / question type to the Python service techStack. */
export function resolveAiTechStack(questionType: string, language: string): string {
  if (
    questionType === QuestionType.SHORT_ANSWER ||
    questionType === QuestionType.SYSTEM_DESIGN
  ) {
    return 'text';
  }

  const normalized = (language || 'code').trim().toLowerCase();
  const aliases: Record<string, string> = {
    js: 'node',
    javascript: 'node',
    nodejs: 'node',
    typescript: 'node',
    py: 'python',
    sql: 'mysql',
    php: 'php',
    python: 'python',
    node: 'node',
    react: 'react',
    mysql: 'mysql',
  };
  return aliases[normalized] ?? normalized;
}
