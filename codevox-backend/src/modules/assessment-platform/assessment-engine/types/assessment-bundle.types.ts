/**
 * AI generation output: assessment metadata + independent reusable questions.
 */
export type GeneratedAssessmentMeta = {
  title: string;
  description?: string;
  role: string;
  difficulty: string;
  assessmentType?: string;
  evaluationMode?: 'testcase' | 'ai' | 'hybrid';
  durationMinutes?: number;
};

export type GeneratedQuestionPayload = {
  questionType: string;
  title: string;
  description?: string;
  questionJson: Record<string, unknown>;
  workspaceType?: string;
  evaluationMode?: 'TESTCASE' | 'AI' | 'HYBRID';
  difficulty?: string;
  estimatedDuration?: number;
  marks?: number;
  mandatory?: boolean;
  sortOrder?: number;
  language?: string;
};

export type GeneratedAssessmentBundle = {
  assessment: GeneratedAssessmentMeta;
  questions: GeneratedQuestionPayload[];
};

export type LoadedAssessmentQuestion = {
  id: string;
  questionType: string;
  title: string;
  description: string | null;
  questionJson: Record<string, unknown>;
  workspaceType: string | null;
  evaluationMode: string | null;
  difficulty: string;
  estimatedDuration: number | null;
  marks: number;
  sortOrder: number;
  mandatory: boolean;
  language: string | null;
  environmentConfig?: Record<string, unknown> | null;
  evaluationConfig?: Record<string, unknown> | null;
};

export type AssessmentWithQuestions = {
  assessment: {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    totalMarks: number;
    status: string;
    role?: string | null;
  };
  questions: LoadedAssessmentQuestion[];
};
