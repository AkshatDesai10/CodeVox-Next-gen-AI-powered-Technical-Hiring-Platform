import {
  authedFetch,
  clientApiDelete,
  clientApiGet,
  clientApiPatch,
  clientApiPost,
  clientApiPut,
} from '@/lib/client-api';

import { recruitmentApiBase } from '@/lib/recruitment-api-base';
import type { RubricQuestionPlan } from '@/modules/job-profiles/lib/rubric-question-plan';

const API_BASE = () => recruitmentApiBase();

type Envelope<T> = { success: boolean; message: string; data: T };

export type JobProfileStatus =
  | 'draft'
  | 'pending_approval'
  | 'active'
  | 'paused'
  | 'closed'
  | 'archived';

export type PipelineSegment = {
  stage_id: string;
  label: string;
  count: number;
};

export type JobProfileSummary = {
  id: string;
  slug: string;
  title: string;
  department: string | null;
  seniority_level: string | null;
  employment_type: string | null;
  openings_count: number;
  responsibilities: string[];
  required_skills: string[];
  nice_to_have_skills: string[];
  experience_min: number | null;
  experience_max: number | null;
  compensation_band_min: number | null;
  compensation_band_max: number | null;
  currency: string | null;
  location_mode: string | null;
  location_text: string | null;
  language_required: string | null;
  owner_user_id: string | null;
  hiring_manager_user_id: string | null;
  status: JobProfileStatus;
  assessment_template_id: string | null;
  autonomous_interview_config: Record<string, unknown> | null;
  candidate_facing_intro: string | null;
  compliance_config?: Record<string, unknown> | null;
  threshold_config?: Record<string, unknown> | null;
  progression_config?: {
    mode?: 'sequential' | 'elimination';
    elimination_threshold?: number;
  } | null;
  notification_config?: Record<string, unknown> | null;
  version: number;
  published_at: string | null;
  created_at?: string;
  updated_at?: string;
  pipeline?: { segments: PipelineSegment[]; total: number };
};

export type JobProfileStage = {
  id: string;
  stage_key: string;
  name: string;
  description: string | null;
  sort_order: number;
  mode: 'ai_led' | 'human_led';
  mandatory: boolean;
  stage_type: string;
  skip_rules?: Record<string, unknown> | null;
  round_config?: Record<string, unknown> | null;
};

export type JobProfileCompetency = {
  id: string;
  stage_id: string | null;
  name: string;
  category: 'hard' | 'soft';
  target_score: number | null;
  weight_pct: number;
  sort_order: number;
  question_plan?: RubricQuestionPlan | null;
};

export type JobProfileQuestion = {
  id: string;
  stage_id: string | null;
  kind: 'anchor' | 'manual' | 'ai_adaptive';
  prompt: string;
  sort_order: number;
  metadata: Record<string, unknown> | null;
};

export type JobProfileDetail = {
  profile: JobProfileSummary;
  stages: JobProfileStage[];
  competencies: JobProfileCompetency[];
  questions: JobProfileQuestion[];
};

export type JobProfileAnalytics = {
  health_score: number;
  alignment_score: number;
  fairness_index: number;
  funnel: Array<{ stage_id: string; name: string; count: number }>;
  totals: {
    applications: number;
    hired: number;
    rejected: number;
    in_progress: number;
  };
  insights: Array<{ type: string; title: string; message: string }>;
};

async function unwrap<T>(promise: Promise<Envelope<T>>): Promise<T> {
  const res = await promise;
  return res.data;
}

export function listJobProfiles(params?: {
  search?: string;
  status?: string;
  department?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.department) q.set('department', params.department);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  const qs = q.toString();
  return unwrap(
    clientApiGet<Envelope<{ items: JobProfileSummary[]; total: number; page: number; pageSize: number }>>(
      `/api/job-profiles${qs ? `?${qs}` : ''}`,
    ),
  );
}

export function getJobProfile(id: string) {
  return unwrap(clientApiGet<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}`));
}

export function inviteCandidateToInterview(
  profileId: string,
  body: {
    lead_id: string;
    first_name: string;
    last_name?: string;
    email: string;
    phone?: string;
    resume_url?: string;
    experience_years?: number;
    skills?: string[];
  },
) {
  return unwrap(
    clientApiPost<
      Envelope<{
        application_token: string;
        interview_url: string;
        candidate_id: string;
        reused: boolean;
      }>
    >(`/api/job-profiles/${profileId}/invite`, body),
  );
}

export type PipelinePresetId =
  | 'coding_only'
  | 'unified_voice'
  | 'coding_plus_voice'
  | 'screening_plus_full';

export type ParsedJobProfileJd = {
  title: string;
  department: string;
  seniority_level: string;
  employment_type: string;
  openings_count: number;
  location_mode: string;
  location_text: string;
  compensation_band_min?: number | null;
  compensation_band_max?: number | null;
  currency?: string | null;
  candidate_facing_intro: string;
  responsibilities: string[];
  required_skills: string[];
  nice_to_have_skills: string[];
  experience_min: number;
  experience_max: number;
  recommended_pipeline: PipelinePresetId;
  ai_powered?: boolean;
};

export function createJobProfile(body: {
  title: string;
  department?: string;
  pipeline_preset?: PipelinePresetId | string;
}) {
  return unwrap(clientApiPost<Envelope<JobProfileDetail>>('/api/job-profiles', body));
}

export function applyPipelinePreset(id: string, preset: PipelinePresetId | string) {
  return unwrap(
    clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/apply-pipeline-preset`, {
      preset,
    }),
  );
}

export function updateJobProfileBasics(id: string, body: Record<string, unknown>) {
  return unwrap(clientApiPatch<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/basics`, body));
}

export function updateJobProfileJd(id: string, body: Record<string, unknown>) {
  return unwrap(clientApiPut<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/jd`, body));
}

export function updateJobProfileStages(id: string, stages: Array<Record<string, unknown>>) {
  return unwrap(
    clientApiPut<Envelope<JobProfileStage[]>>(`/api/job-profiles/${id}/stages`, { stages }),
  );
}

export function reorderJobProfileStages(id: string, stageIds: string[]) {
  return unwrap(
    clientApiPut<Envelope<JobProfileStage[]>>(`/api/job-profiles/${id}/stages/reorder`, {
      stage_ids: stageIds,
    }),
  );
}

export function updateJobProfileCompetencies(
  id: string,
  competencies: Array<Record<string, unknown>>,
) {
  return unwrap(
    clientApiPut<Envelope<JobProfileCompetency[]>>(`/api/job-profiles/${id}/competencies`, {
      competencies,
    }),
  );
}

export function updateJobProfileQuestions(id: string, questions: Array<Record<string, unknown>>) {
  return unwrap(
    clientApiPut<Envelope<JobProfileQuestion[]>>(`/api/job-profiles/${id}/questions`, {
      questions,
    }),
  );
}

export function getJobProfileAnalytics(id: string) {
  return unwrap(clientApiGet<Envelope<JobProfileAnalytics>>(`/api/job-profiles/${id}/analytics`));
}

export function createJobProfilePreviewSession(id: string) {
  return unwrap(
    clientApiPost<Envelope<{ candidate_token: string; interview_url: string; is_preview: boolean }>>(
      `/api/job-profiles/${id}/preview-session`,
      {},
    ),
  );
}

export function publishJobProfile(id: string) {
  return unwrap(clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/publish`, {}));
}

export function pauseJobProfile(id: string) {
  return unwrap(clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/pause`, {}));
}

export function closeJobProfile(id: string) {
  return unwrap(clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/close`, {}));
}

export function archiveJobProfile(id: string) {
  return unwrap(clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/archive`, {}));
}

export function cloneJobProfile(id: string) {
  return unwrap(clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/clone`, {}));
}

export async function deleteJobProfile(id: string) {
  await clientApiDelete(`/api/job-profiles/${id}`);
}

export function getJobProfileAiInsights(id: string) {
  return unwrap(
    clientApiGet<
      Envelope<{
        health_score: number;
        bias_screening: Record<string, unknown> | null;
        compensation_benchmark: Record<string, unknown> | null;
        duplicate_matches: Array<{ profile_id: string; title: string; similarity: number }>;
        candidate_faq: Array<{ question: string; answer: string }>;
        fairness: { buckets: Array<{ label: string; count: number; avg_score: number }>; note: string };
        ai_powered: boolean;
      }>
    >(`/api/job-profiles/${id}/ai-insights`),
  );
}

export function suggestCompetencies(id: string, stageType?: string) {
  const url = stageType 
    ? `/api/job-profiles/ai/suggest-competencies/${id}?stage_type=${stageType}`
    : `/api/job-profiles/ai/suggest-competencies/${id}`;
  return unwrap(
    clientApiPost<
      Envelope<{
        suggestions: Array<{ name: string; category: string; target_score: number; weight_pct: number }>;
        ai_powered: boolean;
      }>
    >(url, {})
  );
}

export function suggestCompetenciesByRole(role: string, seniority?: string) {
  return unwrap(
    clientApiPost<
      Envelope<{
        suggestions: Array<{ name: string; category: 'hard' | 'soft'; description?: string }>;
        ai_powered: boolean;
      }>
    >('/api/job-profiles/ai/suggest-competencies-by-role', { role, seniority })
  );
}

export function suggestRubricWeights(id: string) {
  return unwrap(
    clientApiPost<
      Envelope<{
        suggestions: Array<
          | { id: string; weight_pct: number }
          | {
              name: string;
              category: string;
              weight_pct: number;
              target_score: number;
            }
        >;
        ai_powered: boolean;
        note?: string;
      }>
    >(`/api/job-profiles/ai/suggest-rubric/${id}`, {}),
  );
}

export function generateAiQuestions(id: string, count?: number, stageId?: string) {
  return unwrap(
    clientApiPost<
      Envelope<{
        questions: Array<{
          kind: string;
          prompt: string;
          stage_id?: string | null;
          metadata?: Record<string, unknown>;
        }>;
        stage_id?: string | null;
      }>
    >(`/api/job-profiles/ai/generate-questions/${id}`, { count, stage_id: stageId }),
  );
}

export type BankContentMapResult = {
  question_ids: string[];
  problem_ids: string[];
  mapping_notes?: string;
  ai_powered?: boolean;
};

export function mapBankContentToProfile(
  id: string,
  body: {
    stage_id?: string;
    max_questions?: number;
    max_problems?: number;
    content_type?: 'question' | 'problem' | 'both';
  },
) {
  return unwrap(
    clientApiPost<Envelope<BankContentMapResult>>(`/api/job-profiles/ai/map-bank-content/${id}`, body),
  );
}

export function biasScreenJobProfile(id: string) {
  return unwrap(clientApiPost<Envelope<Record<string, unknown>>>(`/api/job-profiles/ai/bias-screen/${id}`, {}));
}

export function compensationBenchmark(id: string) {
  return unwrap(
    clientApiPost<Envelope<Record<string, unknown>>>(`/api/job-profiles/ai/compensation-benchmark/${id}`, {}),
  );
}

export function generateFaq(id: string) {
  return unwrap(
    clientApiPost<Envelope<{ faq: Array<{ question: string; answer: string }> }>>(
      `/api/job-profiles/ai/generate-faq/${id}`,
      {},
    ),
  );
}

export async function uploadProjectInterviewFile(
  file: File,
  kind: 'assessment_document' | 'supporting_dataset' | 'answer_key',
): Promise<{
  filename: string;
  file_url: string;
  extracted_text?: string;
  title?: string;
  teaser?: string;
  uploaded_at?: string;
  requirements?: Array<{ text: string; weight: number }>;
  grading_rubric?: {
    tasks: Array<{ id: string; name: string; subparts: Array<{ name: string; marks: number }> }>;
  } | null;
}> {
  const body = new FormData();
  body.append('file', file);
  body.append('kind', kind);
  const res = await authedFetch('/api/job-profiles/project-interview/files', { method: 'POST', body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Upload failed');
  }
  const json = (await res.json()) as Envelope<{
    filename: string;
    file_url: string;
    extracted_text?: string;
    title?: string;
    teaser?: string;
    requirements?: Array<{ text: string; weight: number }>;
    grading_rubric?: {
      tasks: Array<{ id: string; name: string; subparts: Array<{ name: string; marks: number }> }>;
    } | null;
  }>;
  return json.data;
}

export async function generateProjectRequirements(body: {
  title: string;
  description_md: string;
}): Promise<Array<{ text: string; weight: number }>> {
  return unwrap(
    clientApiPost<Envelope<Array<{ text: string; weight: number }>>>(
      '/api/job-profiles/ai/generate-project-requirements',
      body,
    ),
  );
}

export function nlEditJobProfile(id: string, instruction: string) {
  return unwrap(
    clientApiPost<Envelope<{ patch: Record<string, unknown>; applied: boolean }>>(
      `/api/job-profiles/ai/nl-edit/${id}`,
      { instruction },
    ),
  );
}

export function checkDuplicateProfiles(id: string) {
  return unwrap(
    clientApiGet<
      Envelope<{
        fingerprint: string;
        matches: Array<{ profile_id: string; title: string; similarity: number }>;
      }>
    >(`/api/job-profiles/ai/check-duplicates/${id}`),
  );
}

export function draftJobProfileJd(body: { title: string; brief?: string; department?: string }) {
  return unwrap(
    clientApiPost<
      Envelope<{
        responsibilities: string[];
        required_skills: string[];
        nice_to_have_skills: string[];
        experience_min: number;
        experience_max: number;
        ai_powered?: boolean;
      }>
    >('/api/job-profiles/ai/draft-jd', body),
  );
}

export function parseJobProfileJd(body: { jd_text: string }) {
  return unwrap(
    clientApiPost<Envelope<ParsedJobProfileJd>>('/api/job-profiles/ai/parse-jd', body),
  );
}

export async function exportJobProfilesCsv(): Promise<string> {
  const session = await import('next-auth/react').then((m) => m.getSession());
  const token = session?.access_token;
  if (!token) throw new Error('Missing access token');
  const res = await fetch(`${API_BASE()}/api/job-profiles/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Export failed');
  return res.text();
}

export type PublicJobProfile = {
  slug: string;
  title: string;
  department: string | null;
  seniority_level: string | null;
  employment_type: string | null;
  location_mode: string | null;
  location_text: string | null;
  language_required: string | null;
  responsibilities: string[];
  required_skills: string[];
  nice_to_have_skills: string[];
  candidate_facing_intro: string | null;
};

export async function getPublicJobProfile(slug: string) {
  const res = await fetch(`${API_BASE()}/api/job-profiles/public/${slug}`);
  if (!res.ok) throw new Error('Job not found');
  const json = (await res.json()) as Envelope<PublicJobProfile>;
  return json.data;
}

export async function applyToJobProfile(
  slug: string,
  body: {
    first_name: string;
    last_name?: string;
    email: string;
    phone?: string;
    experience_years?: number;
    skills?: string[];
  },
) {
  const res = await fetch(`${API_BASE()}/api/job-profiles/public/${slug}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Application failed');
  }
  const json = (await res.json()) as Envelope<{
    application_token: string;
    interview_url: string;
    candidate_id: string;
  }>;
  return json.data;
}

export type JobProfileVersion = {
  id: string;
  version_number: number;
  created_by_user_id: string | null;
  created_at: string;
};

export type ExtendedAnalytics = JobProfileAnalytics & {
  time_to_fill_days: number | null;
  score_histogram: Array<{ bucket: string; count: number }>;
  stage_sla: Array<{ stage_id: string; name: string; candidates: number; sla_breaches: number }>;
  stall_threshold_days: number;
  selected_days?: number | null;
  assessment_metrics?: {
    total_interviews: number;
    avg_voice_score: number | null;
    avg_coding_score: number | null;
    proctor_clean_count: number;
    proctor_strike_count: number;
    proctor_terminated_count: number;
    proctor_pass_rate_pct: number;
    interview_pass_rate_pct: number | null;
  };
};

export function listJobProfileVersions(id: string) {
  return unwrap(clientApiGet<Envelope<JobProfileVersion[]>>(`/api/job-profiles/${id}/versions`));
}

export function diffJobProfileVersions(id: string, from: number, to: number) {
  const q = new URLSearchParams({ from: String(from), to: String(to) });
  return unwrap(
    clientApiGet<Envelope<{ from: number; to: number; changes: Array<{ path: string; before: unknown; after: unknown }> }>>(
      `/api/job-profiles/${id}/versions/diff?${q}`,
    ),
  );
}

export function updateJobProfilePhase2Config(id: string, body: Record<string, unknown>) {
  return unwrap(
    clientApiPatch<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/phase2-config`, body),
  );
}

export function submitJobProfileForApproval(id: string) {
  return unwrap(
    clientApiPost<Envelope<{ approval_id: string; status: string }>>(
      `/api/job-profiles/${id}/submit-for-approval`,
      {},
    ),
  );
}

export function approveJobProfile(id: string, comment?: string) {
  return unwrap(
    clientApiPost<Envelope<JobProfileDetail>>(`/api/job-profiles/${id}/approve`, { comment }),
  );
}

export function rejectJobProfileApproval(id: string, comment?: string) {
  return unwrap(
    clientApiPost<Envelope<{ status: string }>>(`/api/job-profiles/${id}/reject-approval`, {
      comment,
    }),
  );
}

export function listCompetencyLibrary(department?: string) {
  const q = department ? `?department=${encodeURIComponent(department)}` : '';
  return unwrap(
    clientApiGet<
      Envelope<
        Array<{
          id: string;
          name: string;
          category: string;
          description: string | null;
          default_target_score: number | null;
          default_weight_pct: number | null;
        }>
      >
    >(`/api/job-profiles/library/competencies${q}`),
  );
}

export function listJobProfileCompetencyCatalog(department?: string) {
  const q = department ? `?department=${encodeURIComponent(department)}` : '';
  return unwrap(
    clientApiGet<
      Envelope<
        Array<{
          id: string;
          name: string;
          category: string;
          description: string | null;
          default_target_score: number | null;
          default_weight_pct: number | null;
          profile_count: number;
        }>
      >
    >(`/api/job-profiles/library/profile-competencies${q}`),
  );
}

export function listQuestionLibrary(department?: string) {
  const q = department ? `?department=${encodeURIComponent(department)}` : '';
  return unwrap(
    clientApiGet<
      Envelope<Array<{ id: string; prompt: string; kind: string; stage_type: string | null }>>
    >(`/api/job-profiles/library/questions${q}`),
  );
}

export function listPreviewAudits(profileId: string) {
  return unwrap(
    clientApiGet<
      Envelope<
        Array<{
          id: string;
          candidate_token: string;
          event_count: number;
          started_at: string;
          ended_at: string | null;
        }>
      >
    >(`/api/job-profiles/${profileId}/preview-audits`),
  );
}

export function getExtendedJobProfileAnalytics(id: string, days?: number | null) {
  const q = days ? `?days=${days}` : '';
  return unwrap(clientApiGet<Envelope<ExtendedAnalytics>>(`/api/job-profiles/${id}/analytics${q}`));
}

export type QuestionBankQuestion = {
  id: string;
  questionText: string;
  questionType: string;
  difficulty: string;
  status: string;
  competencyTags: string[] | null;
  topicTags: string[] | null;
  usageCount: number;
  createdAt: string;
  followUpTrigger?: string | null;
  redFlagSignals?: string[] | null;
  biasCheckPassed?: boolean;
  biasCheckNotes?: string | null;
};

export type QuestionBankQuestionDetail = QuestionBankQuestion & {
  questionTextPlain?: string | null;
  expectedAnswerNotes?: string | null;
  idealAnswerKeywords?: string[] | null;
  followUpQuestion?: string | null;
  timeGuidanceSeconds?: number | null;
  updatedAt?: string;
};

export type QuestionBankAiDraft = {
  question_text: string;
  question_type: string;
  difficulty: string;
  competency_tags: string[];
  seniority_level?: string;
  follow_up_question?: string;
  follow_up_trigger?: string;
  expected_answer_notes?: string;
  ideal_answer_keywords?: string[];
  red_flag_signals?: string[];
  topic_tags?: string[];
  bias_check_passed?: boolean;
  bias_check_notes?: string;
  time_guidance_minutes?: number;
};

export type QuestionBankAiGenerateResult = {
  drafts: QuestionBankAiDraft[];
  competency_coverage_notes?: string;
  seniority_calibration_notes?: string;
  ai_powered?: boolean;
};

export type ProblemBankProblem = {
  id: string;
  title: string;
  statementMd: string;
  difficulty: string;
  marks?: number;
  status: string;
  topicTags: string[] | null;
  allowedLanguages: string[] | null;
  timeLimitMinutes?: number | null;
  workspaceType?: string | null;
  evaluationMode?: 'TESTCASE' | 'AI' | 'HYBRID' | null;
  environmentConfig?: Record<string, unknown> | null;
  evaluationConfig?: Record<string, unknown> | null;
  testCaseCount?: number;
  usageCount: number;
  createdAt: string;
};

export function listQuestionBank(body?: Record<string, unknown>) {
  return unwrap(
    clientApiPost<
      Envelope<{ items: QuestionBankQuestion[]; total: number; page: number; page_size: number; total_pages: number }>
    >('/api/job-profiles/question-bank', body ?? {}),
  );
}

export function createQuestionBankQuestion(body: Record<string, unknown>) {
  return unwrap(clientApiPost<Envelope<QuestionBankQuestion>>('/api/job-profiles/question-bank/create', body));
}

export function getQuestionBankQuestion(id: string) {
  return unwrap(clientApiGet<Envelope<QuestionBankQuestionDetail>>(`/api/job-profiles/question-bank/${id}`));
}

export function updateQuestionBankQuestion(id: string, body: Record<string, unknown>) {
  return unwrap(clientApiPatch<Envelope<QuestionBankQuestion>>(`/api/job-profiles/question-bank/${id}`, body));
}

export function archiveQuestionBankQuestion(id: string) {
  return unwrap(clientApiPost<Envelope<QuestionBankQuestion>>(`/api/job-profiles/question-bank/${id}/archive`, {}));
}

export function bulkQuestionBankAction(body: Record<string, unknown>) {
  return unwrap(clientApiPost<Envelope<{ affected: number }>>('/api/job-profiles/question-bank/bulk', body));
}

export function listQuestionBankVersions(id: string) {
  return unwrap(clientApiGet<Envelope<Array<Record<string, unknown>>>>(`/api/job-profiles/question-bank/${id}/versions`));
}

export function restoreQuestionBankVersion(id: string, versionNumber: number) {
  return unwrap(clientApiPost<Envelope<QuestionBankQuestion>>(`/api/job-profiles/question-bank/${id}/restore`, { version_number: versionNumber }));
}

export function listProblemBank(body?: Record<string, unknown>) {
  return unwrap(
    clientApiPost<
      Envelope<{ items: ProblemBankProblem[]; total: number; page: number; page_size: number; total_pages: number }>
    >('/api/job-profiles/problem-bank', body ?? {}),
  );
}

export function createProblemBankProblem(body: Record<string, unknown>) {
  return unwrap(clientApiPost<Envelope<ProblemBankProblem>>('/api/job-profiles/problem-bank/create', body));
}

export function updateProblemBankProblem(id: string, body: Record<string, unknown>) {
  return unwrap(clientApiPatch<Envelope<ProblemBankProblem>>(`/api/job-profiles/problem-bank/${id}`, body));
}

export function getProblemBankProblem(id: string) {
  return unwrap(clientApiGet<Envelope<Record<string, unknown>>>(`/api/job-profiles/problem-bank/${id}`));
}

export function upsertProblemBankTestCases(id: string, testCases: Array<Record<string, unknown>>) {
  return unwrap(clientApiPut<Envelope<Array<Record<string, unknown>>>>(`/api/job-profiles/problem-bank/${id}/test-cases`, { test_cases: testCases }));
}

export function publishProblemBankProblem(id: string) {
  return unwrap(clientApiPost<Envelope<{ valid: boolean }>>(`/api/job-profiles/problem-bank/${id}/publish`, {}));
}

export function archiveProblemBankProblem(id: string) {
  return unwrap(clientApiPost<Envelope<ProblemBankProblem>>(`/api/job-profiles/problem-bank/${id}/archive`, {}));
}

export function listProblemBankVersions(id: string) {
  return unwrap(clientApiGet<Envelope<Array<Record<string, unknown>>>>(`/api/job-profiles/problem-bank/${id}/versions`));
}

export function generateQuestionBankAiDrafts(body: Record<string, unknown>) {
  return unwrap(
    clientApiPost<Envelope<QuestionBankAiGenerateResult>>('/api/job-profiles/question-bank/ai/generate', body),
  );
}

export function generateProblemBankAiDraft(body: Record<string, unknown>) {
  return unwrap(clientApiPost<Envelope<{ draft: Record<string, unknown>; ai_powered?: boolean; generator?: string }>>('/api/job-profiles/problem-bank/ai/generate', body));
}

export function generateDatabaseAssessmentAiDraft(body: Record<string, unknown>) {
  return unwrap(
    clientApiPost<Envelope<{ draft: Record<string, unknown>; ai_powered?: boolean; generator?: string }>>(
      '/api/job-profiles/problem-bank/ai/generate-database',
      body,
    ),
  );
}

export function snapshotRoundContent(body: Record<string, unknown>) {
  return unwrap(clientApiPost<Envelope<{ question_items: number; problem_items: number }>>('/api/job-profiles/round-content/snapshot', body));
}

export function getRoundContentSnapshot(jobApplicationId: string) {
  return unwrap(clientApiGet<Envelope<{ questions: Array<Record<string, unknown>>; problems: Array<Record<string, unknown>> }>>(`/api/job-profiles/round-content/snapshot/${jobApplicationId}`));
}

export function getQuestionProblemBankAnalytics() {
  return unwrap(clientApiGet<Envelope<Record<string, unknown>>>('/api/job-profiles/banks/analytics'));
}


export async function verifyProblemDraft(payload: { language: string; sourceCode: string; testCases: any[]; environmentConfig?: any }) {
  const data = await clientApiPost<any>('/api/job-profiles/problem-bank/verify-draft', payload);
  return data;
}

export type JobProfilesDashboardStats = {
  problemBank: {
    totalDraft: number;
    totalPublished: number;
    codingProblems: number;
    databaseProblems: number;
  };
  integrity: {
    activeTests: number;
    flaggedCandidates: number;
    averageTrustScore: number;
  };
};

export async function getJobProfilesDashboardStats(): Promise<JobProfilesDashboardStats> {
  const res = await clientApiGet<any>('/api/job-profiles/dashboard/stats');
  return res.data;
}
