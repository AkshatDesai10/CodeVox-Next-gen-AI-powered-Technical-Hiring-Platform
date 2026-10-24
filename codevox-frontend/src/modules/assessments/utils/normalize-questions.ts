import type { AssessmentQuestionDto, TestCaseDto } from '@/types/assessments';
import { formatTestCaseField } from '@/modules/assessments/utils/format-test-case';

function normalizeTestCase(raw: Record<string, unknown>): TestCaseDto {
  return {
    id: String(raw.id ?? ''),
    input: formatTestCaseField(raw.input, 'input'),
    expectedOutput: formatTestCaseField(
      raw.expectedOutput ?? raw.expected_output,
      'output',
    ),
  };
}

export function normalizeAssessmentQuestion(
  raw: Record<string, unknown>,
): AssessmentQuestionDto {
  const testCasesRaw = raw.testCases ?? raw.test_cases;
  let testCases = Array.isArray(testCasesRaw)
    ? testCasesRaw.map((tc) => normalizeTestCase(tc as Record<string, unknown>))
    : [];

  const questionJson =
    raw.questionJson && typeof raw.questionJson === 'object'
      ? (raw.questionJson as Record<string, unknown>)
      : raw.question_json && typeof raw.question_json === 'object'
        ? (raw.question_json as Record<string, unknown>)
        : undefined;

  if (!testCases.length && questionJson && Array.isArray(questionJson.testCases)) {
    testCases = (questionJson.testCases as Array<Record<string, unknown>>)
      .filter((tc) => !tc.isHidden && !tc.is_hidden)
      .map((tc, index) =>
        normalizeTestCase({
          id: String(tc.id ?? index + 1),
          input: tc.input,
          expectedOutput: tc.expectedOutput ?? tc.expected_output,
        }),
      );
  }

  return {
    id: String(raw.id ?? raw.questionId ?? raw.question_id ?? ''),
    title: String(raw.title ?? 'Question'),
    description:
      raw.description != null ? String(raw.description) : null,
    questionType: String(raw.questionType ?? raw.question_type ?? 'CODING'),
    difficulty: String(raw.difficulty ?? 'MEDIUM'),
    marks: Number(raw.marks ?? 0),
    language: raw.language != null ? String(raw.language) : null,
    sortOrder: Number(raw.sortOrder ?? raw.sort_order ?? 0),
    estimatedDuration:
      raw.estimatedDuration != null
        ? Number(raw.estimatedDuration)
        : raw.estimated_duration != null
          ? Number(raw.estimated_duration)
          : null,
    questionJson,
    testCases,
    mcqOptions: Array.isArray(raw.mcqOptions)
      ? (raw.mcqOptions as AssessmentQuestionDto['mcqOptions'])
      : Array.isArray(raw.mcq_options)
        ? (raw.mcq_options as AssessmentQuestionDto['mcqOptions'])
        : undefined,
  };
}

export function normalizeAssessmentQuestions(
  rows: unknown,
): AssessmentQuestionDto[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => normalizeAssessmentQuestion(row as Record<string, unknown>))
    .filter((q) => q.id.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
