/**
 * Role-agnostic assessment document stored in template_json / assessment_json.
 * UI and evaluators read this schema dynamically — no per-role DB columns.
 */
export type EvaluationMode = 'testcase' | 'ai' | 'hybrid';

export type AssessmentSectionComponent =
  | 'code_editor'
  | 'text_response'
  | 'sql_editor'
  | 'architecture'
  | 'file_upload'
  | 'diagram'
  | 'mcq'
  | 'voice';

export type AssessmentSection = {
  id: string;
  component: AssessmentSectionComponent;
  title: string;
  prompt: string;
  marks?: number;
  config?: Record<string, unknown>;
  evaluation?: {
    mode?: EvaluationMode;
    criteria?: string[];
    testCases?: Array<{ input?: string; expectedOutput?: string; isHidden?: boolean }>;
    weights?: Record<string, number>;
  };
};

export type AssessmentDocument = {
  version: 1;
  meta: {
    title: string;
    role: string;
    difficulty: string;
    assessmentType: string;
    evaluationMode: EvaluationMode;
    durationMinutes?: number;
    description?: string;
  };
  workspace?: Record<string, unknown>;
  sections: AssessmentSection[];
};

export type SubmissionPayload = Record<string, unknown>;

export type EvaluationJson = {
  overallScore: number;
  maxScore: number;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  criteriaScores?: Record<string, number>;
  strategy?: string;
  raw?: Record<string, unknown>;
};
