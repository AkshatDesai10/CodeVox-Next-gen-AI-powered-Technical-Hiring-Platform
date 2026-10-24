import { clientApiGet, clientApiPatch, clientApiPost } from '@/lib/client-api';
import type {
  ApiEnvelope,
  AssessmentDashboardSummary,
  AssessmentDto,
  AssessmentQuestionDto,
  AssessmentResultResponse,
  AttemptResponse,
  CandidateAssignmentDto,
  CandidateDto,
  GeneratedQuestionDto,
  RunCodeResponse,
  StartAssessmentResponse,
  SubmitAnswerResponse,
  SubmitAssessmentResponse,
} from '@/types/assessments';

import { recruitmentApiBase } from '@/lib/recruitment-api-base';

const API_BASE = () => recruitmentApiBase();

async function publicApiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function publicApiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function getAssessmentQuestionsPreview(assessmentId: string) {
  return publicApiGet<ApiEnvelope<AssessmentQuestionDto[]>>(
    `/api/assessment/assessments/${assessmentId}/questions`,
  );
}

export function listCandidateAssignments(candidateId: string) {
  return publicApiGet<ApiEnvelope<CandidateAssignmentDto[]>>(
    `/api/assessment/candidate/${candidateId}/assignments`,
  );
}

export function startAssessment(candidateId: string, assessmentId: string) {
  return publicApiPost<ApiEnvelope<StartAssessmentResponse>>('/api/assessment/start', {
    candidate_id: candidateId,
    assessment_id: assessmentId,
  });
}

export function getAssessmentAttempt(candidateAssessmentId: string) {
  return publicApiGet<ApiEnvelope<AttemptResponse>>(
    `/api/assessment/${candidateAssessmentId}`,
  );
}

export function runAssessmentCode(payload: {
  question_id: string;
  language: string;
  source_code: string;
  input?: string;
}) {
  return publicApiPost<ApiEnvelope<RunCodeResponse>>('/api/assessment/run-code', payload);
}

export function saveAssessmentDraft(payload: {
  candidate_assessment_id: string;
  question_id: string;
  language: string;
  source_code: string;
}) {
  return publicApiPost<ApiEnvelope<{ questionId: string; status: string; savedAt: string }>>(
    '/api/assessment/save-draft',
    payload,
  );
}

export function submitAssessmentAnswer(payload: {
  candidate_assessment_id: string;
  question_id: string;
  language: string;
  source_code: string;
}) {
  return publicApiPost<ApiEnvelope<SubmitAnswerResponse>>(
    '/api/assessment/submit-answer',
    payload,
  );
}

export function submitAssessment(candidateAssessmentId: string) {
  return publicApiPost<ApiEnvelope<SubmitAssessmentResponse>>('/api/assessment/submit', {
    candidate_assessment_id: candidateAssessmentId,
  });
}

export function getAssessmentResult(candidateAssessmentId: string) {
  return publicApiGet<ApiEnvelope<AssessmentResultResponse>>(
    `/api/assessment/result/${candidateAssessmentId}`,
  );
}

export function getAssessmentDashboardSummary() {
  return clientApiGet<ApiEnvelope<AssessmentDashboardSummary>>(
    '/api/assessment/admin/summary',
  );
}

export function listAssessmentCandidates() {
  return clientApiGet<ApiEnvelope<CandidateDto[]>>('/api/assessment/admin/candidates');
}

export function listAssessmentsAdmin() {
  return clientApiGet<ApiEnvelope<AssessmentDto[]>>('/api/assessment/admin/assessments');
}

export function updateAssessmentStatus(
  assessmentId: string,
  body: { status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' },
) {
  return clientApiPatch<ApiEnvelope<AssessmentDto>>(
    `/api/assessment/admin/assessments/${assessmentId}`,
    body,
  );
}

async function platformPost<T>(path: string, body: unknown) {
  return clientApiPost<T>(path, body);
}

export function listPlatformQuestions() {
  return clientApiGet<ApiEnvelope<import('@/types/assessments').PlatformQuestionDto[]>>(
    '/api/assessment/admin/platform/questions',
  );
}

export function createPlatformQuestion(body: Record<string, unknown>) {
  return platformPost<ApiEnvelope<unknown>>('/api/assessment/admin/platform/questions', body);
}

export function generatePlatformQuestion(body: {
  prompt: string;
  difficulty?: string;
  experience_level?: string;
  question_type?: string;
  skills?: string[];
  save?: boolean;
}) {
  return platformPost<
    ApiEnvelope<GeneratedQuestionDto | { generated: GeneratedQuestionDto; question: unknown }>
  >('/api/assessment/admin/platform/questions/generate', body);
}

export function savePlatformGeneratedQuestion(generated: GeneratedQuestionDto) {
  return platformPost<ApiEnvelope<{ generated: GeneratedQuestionDto; question: unknown }>>(
    '/api/assessment/admin/platform/questions/save',
    { generated },
  );
}

export function createPlatformAssessment(body: Record<string, unknown>) {
  return platformPost<ApiEnvelope<unknown>>('/api/assessment/admin/platform/assessments', body);
}

export function updatePlatformAssessment(id: string, body: Record<string, unknown>) {
  return clientApiPatch<ApiEnvelope<unknown>>(`/api/assessment/admin/platform/assessments/${id}`, body);
}

export function mapQuestionToAssessment(
  assessmentId: string,
  body: { question_id: string; marks: number; sort_order: number },
) {
  return platformPost<ApiEnvelope<unknown>>(
    `/api/assessment/admin/platform/assessments/${assessmentId}/questions`,
    body,
  );
}

export function assignCandidateAssessment(body: { candidate_id: string; assessment_id: string }) {
  return platformPost<ApiEnvelope<unknown>>('/api/assessment/admin/platform/assignments', body);
}

export function previewAiGeneration(assessmentId: string) {
  return platformPost<ApiEnvelope<unknown>>(
    `/api/assessment/admin/platform/assessments/${assessmentId}/preview-generation`,
    {},
  );
}

export function listEnvironmentTemplates() {
  return clientApiGet<ApiEnvelope<import('@/types/assessments').EnvironmentTemplateDto[]>>(
    '/api/assessment/admin/platform/environment-templates',
  );
}

export function respondInterview(payload: {
  candidate_assessment_id: string;
  question_id: string;
  transcript: string;
}) {
  return publicApiPost<ApiEnvelope<unknown>>('/api/assessment/interview/respond', payload);
}
