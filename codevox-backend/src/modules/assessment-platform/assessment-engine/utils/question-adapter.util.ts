import type { AssessmentSection, AssessmentSectionComponent } from '../types/assessment-document.types';
import type { LoadedAssessmentQuestion } from '../types/assessment-bundle.types';

export function resolveQuestionComponent(question: LoadedAssessmentQuestion): AssessmentSectionComponent {
  const ui = question.questionJson?.uiComponent as AssessmentSectionComponent | undefined;
  if (ui) return ui;

  switch (question.questionType.toUpperCase()) {
    case 'CODING':
      return question.language?.toUpperCase() === 'SQL' ? 'sql_editor' : 'code_editor';
    case 'MCQ':
      return 'mcq';
    case 'SYSTEM_DESIGN':
      return 'architecture';
    case 'INTERVIEW':
      return 'voice';
    case 'SHORT_ANSWER':
    default:
      return 'text_response';
  }
}

export function questionToSection(question: LoadedAssessmentQuestion): AssessmentSection {
  const evalMode = (question.evaluationMode ?? 'AI').toLowerCase() as 'testcase' | 'ai' | 'hybrid';
  const evalConfig = question.evaluationConfig ?? {};
  return {
    id: question.id,
    component: resolveQuestionComponent(question),
    title: question.title,
    prompt: question.description ?? String(question.questionJson.problemStatement ?? question.questionJson.prompt ?? ''),
    marks: question.marks,
    config: {
      ...question.questionJson,
      language: question.language,
      options: question.questionJson.options,
    },
    evaluation: {
      mode: evalMode,
      criteria: (evalConfig.criteria as string[]) ?? (question.questionJson.evaluationCriteria as string[]),
      testCases: (evalConfig.testCases as Array<{ input?: string; expectedOutput?: string; isHidden?: boolean }>) ??
        (question.questionJson.testCases as Array<{ input?: string; expectedOutput?: string; isHidden?: boolean }>),
    },
  };
}

export function workspaceFromQuestions(questions: LoadedAssessmentQuestion[]): Record<string, unknown> {
  const withWorkspace = questions.find((q) => q.workspaceType && q.workspaceType !== 'none');
  if (!withWorkspace) return { runtime: 'none', workspace: 'none' };
  const env = withWorkspace.environmentConfig ?? {};
  return {
    runtime: withWorkspace.workspaceType,
    services: env.services ?? [],
    ...env,
  };
}
