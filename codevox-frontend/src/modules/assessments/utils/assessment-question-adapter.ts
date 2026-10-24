import type { AssessmentQuestionDto, McqOptionDto } from '@/types/assessments';
import type { GenericQuestion } from '@/types/assessment-engine';

function resolveMcqOptions(
  question: AssessmentQuestionDto,
  json: Record<string, unknown>,
): McqOptionDto[] | undefined {
  if (question.mcqOptions?.length) return question.mcqOptions;
  const raw = json.options;
  if (!Array.isArray(raw) || !raw.length) return undefined;
  return raw.map((opt) => {
    const row = opt as Record<string, unknown>;
    return {
      label: String(row.label ?? row.key ?? ''),
      text: String(row.text ?? row.option ?? row.value ?? ''),
    };
  });
}

export function assessmentQuestionToGeneric(question: AssessmentQuestionDto): GenericQuestion {
  const json = question.questionJson ?? {};
  const mcqOptions = resolveMcqOptions(question, json);
  const testCasesFromDto = question.testCases.map((tc) => ({
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    isHidden: false,
  }));
  const isMcq = question.questionType?.toUpperCase() === 'MCQ';
  return {
    id: question.id,
    questionType: question.questionType,
    title: question.title,
    description: question.description,
    questionJson: {
      ...json,
      options: mcqOptions ?? json.options,
      testCases: Array.isArray(json.testCases) ? json.testCases : testCasesFromDto,
      prompt:
        (isMcq && json.question != null ? String(json.question) : null) ??
        (json.prompt != null ? String(json.prompt) : null) ??
        question.description,
    },
    workspaceType: null,
    evaluationMode: null,
    difficulty: question.difficulty,
    estimatedDuration: question.estimatedDuration ?? null,
    marks: question.marks,
    sortOrder: question.sortOrder,
    mandatory: true,
    language: question.language,
  };
}
