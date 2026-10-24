import { clientApiGet, clientApiPost } from '@/lib/client-api';
import type { ApiEnvelope } from '@/types/assessments';
import type {
  AssessmentEngineSessionDto,
  AssessmentWithQuestions,
} from '@/types/assessment-engine';

async function enginePost<T>(path: string, body: unknown) {
  return clientApiPost<ApiEnvelope<T>>(path, body);
}

async function engineGet<T>(path: string) {
  return clientApiGet<ApiEnvelope<T>>(path);
}

export function getEngineAssessment(assessmentId: string) {
  return engineGet<AssessmentWithQuestions>(`/api/assessment/engine/assessments/${assessmentId}`);
}

export function startEngineSession(body: {
  candidate_id: string;
  template_id?: string;
  assessment_id?: string;
  candidate_assessment_id?: string;
}) {
  return enginePost<{
    sessionId: string;
    candidateAssessmentId: string;
    status: string;
    startedAt: string;
    assessment: AssessmentWithQuestions['assessment'];
    questions: AssessmentWithQuestions['questions'];
  }>('/api/assessment/engine/sessions/start', body);
}

export function getEngineSession(sessionId: string) {
  return engineGet<AssessmentEngineSessionDto>(`/api/assessment/engine/sessions/${sessionId}`);
}

export function submitEngineQuestion(body: {
  candidate_assessment_id: string;
  question_id: string;
  response_json: Record<string, unknown>;
}) {
  return enginePost<unknown>('/api/assessment/engine/question/submit', body);
}

export function evaluateEngineQuestion(body: {
  candidate_assessment_id: string;
  question_id: string;
}) {
  return enginePost<unknown>('/api/assessment/engine/question/evaluate', body);
}

export function submitEngineAssessment(candidateAssessmentId: string) {
  return enginePost<unknown>(
    `/api/assessment/engine/assessments/${candidateAssessmentId}/submit`,
    {},
  );
}

/** @deprecated */
export function submitEngineSection(
  sessionId: string,
  body: {
    section_id: string;
    submission_type: string;
    submission_data: Record<string, unknown>;
  },
) {
  return enginePost<unknown>(`/api/assessment/engine/sessions/${sessionId}/sections/submit`, body);
}

/** @deprecated */
export function submitEngineSession(sessionId: string) {
  return enginePost<unknown>(`/api/assessment/engine/sessions/${sessionId}/submit`, {});
}
