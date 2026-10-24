import type {
  AssessmentDocument,
  AssessmentSection,
  EvaluationJson,
  SubmissionPayload,
} from '../types/assessment-document.types';

export type SectionEvaluationContext = {
  sessionId: string;
  section: AssessmentSection;
  document: AssessmentDocument;
  submission: SubmissionPayload;
};

export interface EvaluationProvider {
  readonly mode: 'testcase' | 'ai' | 'hybrid';
  supports(mode: string): boolean;
  evaluate(ctx: SectionEvaluationContext): Promise<EvaluationJson>;
}

export const EVALUATION_PROVIDERS = 'EVALUATION_PROVIDERS';
