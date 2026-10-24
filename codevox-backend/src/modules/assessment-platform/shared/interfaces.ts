import type { EvaluationStrategyType } from './enums';

export type SessionContext = {
  candidateAssessmentId: string;
  candidateId: string;
  assessmentId: string;
  experienceLevel: string;
  targetSkills: string[];
  questionCount?: number;
};

export type SessionQuestion = {
  questionId: string;
  sortOrder: number;
  source: 'STATIC' | 'AI_GENERATED';
};

export interface QuestionSource {
  resolveQuestions(ctx: SessionContext): Promise<SessionQuestion[]>;
}

export type EnvironmentSpec = {
  runtime: string;
  services?: string[];
  seedData?: { sql?: string[] };
  dockerTemplate?: string;
  setupCommands?: string[];
};

export type WorkspaceHandle = {
  provisionId: string;
  candidateAssessmentId: string;
  questionId?: string;
  endpoints?: Record<string, string>;
};

export interface EnvironmentProvisioner {
  provision(spec: EnvironmentSpec, attemptId: string, questionId?: string): Promise<WorkspaceHandle>;
  teardown(handle: WorkspaceHandle): Promise<void>;
}

export type EvaluationContext = {
  candidateAssessmentId: string;
  questionId: string;
  questionTitle: string;
  marks: number;
  language: string;
  sourceCode: string;
  questionType: string;
  evaluationConfig?: Record<string, unknown> | null;
  environmentConfig?: Record<string, unknown> | null;
  questionJson?: Record<string, unknown> | null;
  problemDescription?: string | null;
};

export type EvaluationResult = {
  score: number;
  maxScore: number;
  status: string;
  executionTime: number;
  executionOutput?: string;
  strategy: EvaluationStrategyType;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  rubricJson?: Record<string, unknown>;
  passedTests?: number;
  totalTests?: number;
  percentage?: number;
};

export interface EvaluationStrategy {
  supports(mode: EvaluationStrategyType): boolean;
  evaluate(ctx: EvaluationContext): Promise<EvaluationResult>;
}

export const QUESTION_SOURCE = 'QUESTION_SOURCE';
export const ENVIRONMENT_PROVISIONER = 'ENVIRONMENT_PROVISIONER';
export const EVALUATION_STRATEGIES = 'EVALUATION_STRATEGIES';
