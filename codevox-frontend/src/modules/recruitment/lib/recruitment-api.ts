import { authedFetch, clientApiDelete, clientApiGet, clientApiPatch, clientApiPost } from '@/lib/client-api';

type Envelope<T> = { success: boolean; message: string; data: T };

function unwrap<T>(promise: Promise<Envelope<T>>): Promise<T> {
  return promise.then((r) => {
    if (!r.success) throw new Error(r.message || 'Request failed');
    return r.data;
  });
}

export type RecruitmentLeadListItem = {
  lead_id: string;
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  lead_stage: string | null;
  lead_sub_stage: string | null;
  portal_stage: string | null;
  effective_stage: string | null;
  priority: string | null;
  acad_year: string | null;
  created_at: string | null;
  counselor_id: string | null;
  lead_source: string | null;
  lead_sub_source: string | null;
  lead_score: number | null;
  ai_score: number | null;
  duplicate_strength: number | null;
  duplicate_match_count: number | null;
  verified_lead: number | null;
  courses: Array<{ course_id?: string; course_name?: string }>;
  resume_url: string | null;
  experience_years: number | null;
  current_company: string | null;
  notice_period_days: number | null;
  invite_status: string | null;
  invite_token: string | null;
  invite_slot_id?: string | null;
  invite_slot_label?: string | null;
  invite_slot_date?: string | null;
  resume_match_status?: string | null;
  resume_match_score?: number | null;
  resume_match_confidence?: number | null;
  resume_match_error?: string | null;
  resume_match_analyzed_at?: string | null;
};

export type ResumeMatchEvaluationRow = {
  factorId: string;
  factor: string;
  importanceScore: number;
  critical: boolean;
  weight: number;
  matchStrength: number;
  evidenceAvailable: boolean;
  applicable: boolean;
  match: string;
  confidence: number;
  evidence: string[];
  reasoning: string;
};

export type ResumeMatchResult = {
  version: number;
  status: string;
  score: number | null;
  confidence: number | null;
  summary: string;
  strengths: string[];
  gaps: string[];
  criticalGaps: string[];
  evaluation: ResumeMatchEvaluationRow[];
  job?: {
    profileId: string | null;
    title: string | null;
    fingerprint: string | null;
    version: number | null;
  };
  cv?: {
    source: string | null;
    hash: string | null;
    charCount: number;
    truncated?: boolean;
  };
  scoring?: {
    method: string;
    analyzerVersion: string;
    score0: number | null;
    criticalGeoMean: number | null;
    gamma: number;
  };
  analyzedAt?: string;
  error?: string;
};

export type RecruitmentInterviewItem = {
  id?: string;
  overlay_id?: string;
  interview_ref_id?: string;
  lead_id: string;
  candidate_name: string;
  email: string | null;
  phone: string | null;
  course_name: string | null;
  interview_type: string | null;
  interview_mode: string | null;
  interview_status: string | null;
  portal_status: string | null;
  effective_status: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  meeting_url: string | null;
  remarks_desc: string | null;
  interview_result: string | null;
  interview_remark: string | null;
  slot_id?: string | null;
  slot_label?: string | null;
  slot_start_time?: string | null;
  slot_end_time?: string | null;
  invite_token?: string | null;
  join_url?: string | null;
  source?: 'invite_slot' | 'local' | 'demo';
  /** Job-profile pipeline rounds (portal applications). */
  pipeline_rounds?: Array<{
    id: string;
    name: string;
    type: string;
    status: 'completed' | 'live' | 'not_started' | 'upcoming';
  }>;
  rounds_completed?: number;
  rounds_total?: number;
  sort_at?: string;
};

export function listRecruitmentLeads(input?: {
  page?: number;
  pageSize?: number;
  acad_year?: string;
  global_filter?: string;
  course_name?: string;
  lead_stage?: string;
  priority?: string;
  counselor_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  return unwrap(
    clientApiPost<
      Envelope<{
        items: RecruitmentLeadListItem[];
        page: number;
        page_size: number;
        total: number;
        total_pages: number;
        has_next_page: boolean;
        has_previous_page: boolean;
        stats: {
          total_active: number;
          high_score: number;
          verified: number;
          duplicates: number;
        };
      }>
    >('/api/recruitment/leads', input ?? {}),
  );
}

export function getRecruitmentLeadStageCounts(input?: {
  acad_year?: string;
  global_filter?: string;
  course_name?: string;
  priority?: string;
  counselor_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  return unwrap(
    clientApiPost<
      Envelope<{
        stage_counts: Record<string, number>;
      }>
    >('/api/recruitment/leads/stage-counts', input ?? {}),
  );
}

export type RecruitmentLeadDocument = {
  document_name?: string;
  document_url?: string;
  document_status?: string;
};

export type RecruitmentLeadDetailLead = RecruitmentLeadListItem & {
  middlename?: string | null;
  whatsappnumber?: string | null;
  gender?: string | null;
  nationality?: string | null;
  corr_country?: string | null;
  corr_state?: string | null;
  corr_city?: string | null;
  form_step_name?: string | null;
  form_completed?: number | null;
  document_uploads?: RecruitmentLeadDocument[];
  educational_details?: unknown[];
  leads_answers?: Record<string, string> | null;
  raw_fields?: Record<string, unknown>;
};

export type RecruitmentLeadOverlay = {
  portal_stage?: string | null;
  counselor_override_id?: string | null;
  notes?: string | null;
  ai_score?: number | null;
  ai_qualification?: {
    verdict?: string;
    score?: number;
    summary?: string;
    reasoning?: Array<{ field: string; note: string }>;
  } | null;
  parsed_resume?: {
    skills?: string[];
    experience_years?: number | null;
    education?: unknown;
    summary?: string;
    resume_url?: string | null;
  } | null;
  resume_mismatch?: boolean;
  last_local_action_at?: string | null;
  invite_status?: string | null;
  invite_token?: string | null;
  invite_slot_id?: string | null;
  invite_slot_label?: string | null;
  invite_slot_date?: string | null;
  resume_match?: ResumeMatchResult | null;
  resume_match_status?: string | null;
  resume_match_score?: number | null;
  resume_match_confidence?: number | null;
  resume_match_error?: string | null;
  resume_match_analyzed_at?: string | null;
};

export type RecruitmentTimelineItem = {
  id?: string;
  event_type?: string;
  eventType?: string;
  event_summary?: string;
  eventSummary?: string;
  occurred_at?: string;
  occurredAt?: string;
};

export type RecruitmentCommunicationItem = {
  id?: string;
  channel?: string;
  direction?: string;
  subject?: string | null;
  body?: string | null;
  sent_at?: string;
  sentAt?: string;
};

export type RecruitmentLeadDetail = {
  lead: RecruitmentLeadDetailLead;
  overlay: RecruitmentLeadOverlay | null;
  interviews: RecruitmentInterviewItem[];
  interviews_local: RecruitmentInterviewItem[];
  autonomous_sessions: Array<{
    application_id: string;
    candidate_token: string;
    status: string;
    interview_url: string | null;
  }>;
  links?: unknown[];
  timeline: RecruitmentTimelineItem[];
  communications: RecruitmentCommunicationItem[];
  ai_brief: string;
};

export function getRecruitmentLead(leadId: string) {
  return unwrap(clientApiGet<Envelope<RecruitmentLeadDetail>>(`/api/recruitment/leads/${leadId}`));
}

export function getLeadResumeScreen(leadId: string) {
  return unwrap(
    clientApiGet<
      Envelope<{
        resume_match_status: string | null;
        resume_match_score: number | null;
        resume_match_confidence: number | null;
        resume_match_error: string | null;
        resume_match_analyzed_at: string | null;
        resume_match: ResumeMatchResult | null;
      }>
    >(`/api/recruitment/leads/${leadId}/resume-screen`),
  );
}

export function rerunLeadResumeScreen(leadId: string) {
  return unwrap(
    clientApiPost<
      Envelope<{
        resume_match_status: string | null;
        resume_match_score: number | null;
        resume_match_confidence: number | null;
        resume_match_error: string | null;
        resume_match_analyzed_at: string | null;
        resume_match?: ResumeMatchResult | null;
      }>
    >(`/api/recruitment/leads/${leadId}/resume-screen`, {}),
  );
}

export function updateLeadOverlay(
  leadId: string,
  body: { portal_stage?: string; counselor_override_id?: string; notes?: string },
) {
  return unwrap(
    clientApiPatch<Envelope<unknown>>(`/api/recruitment/leads/${leadId}/overlay`, body),
  );
}

export function scheduleLocalInterview(
  leadId: string,
  body: {
    appointment_date: string;
    appointment_time: string;
    interview_type: string;
    interview_mode: string;
    remarks_desc?: string;
    meeting_url?: string;
  },
) {
  return unwrap(
    clientApiPost<Envelope<unknown>>(`/api/recruitment/leads/${leadId}/schedule-interview`, body),
  );
}

export function startAiInterview(leadId: string, body?: { job_profile_id?: string }) {
  return unwrap(
    clientApiPost<
      Envelope<{
        application_token: string;
        interview_url: string;
        candidate_id: string;
        reused: boolean;
      }>
    >(`/api/recruitment/leads/${leadId}/start-ai-interview`, body ?? {}),
  );
}

export function scoreLeadAi(leadId: string, courseName?: string) {
  return unwrap(
    clientApiPost<Envelope<{ score: number; summary: string; ai_powered: boolean }>>(
      `/api/recruitment/leads/${leadId}/ai-score`,
      courseName ? { course_name: courseName } : {},
    ),
  );
}

export function qualifyLeadAi(leadId: string, courseName?: string) {
  return unwrap(
    clientApiPost<
      Envelope<{
        verdict: string;
        score: number;
        reasoning: Array<{ field: string; note: string }>;
        summary: string;
      }>
    >(`/api/recruitment/leads/${leadId}/ai-qualification`, courseName ? { course_name: courseName } : {}),
  );
}

export function parseLeadResume(leadId: string) {
  return unwrap(
    clientApiPost<Envelope<{ parsed: Record<string, unknown>; mismatch: boolean }>>(
      `/api/recruitment/leads/${leadId}/parse-resume`,
      {},
    ),
  );
}

export type InviteLeadResult = {
  status: 'INVITED' | 'NO_OPENING' | 'ALREADY_INVITED';
  invite_token?: string;
  interview_url?: string;
  email_sent?: boolean;
  slot_id?: string;
  slot_date?: string | null;
  slot_label?: string | null;
};

export function inviteLeadToAssessment(
  leadId: string,
  input?: { slotId?: string; slotDate?: string },
) {
  const body: Record<string, string> = {};
  if (input?.slotId) body.slot_id = input.slotId;
  if (input?.slotDate) body.slot_date = input.slotDate;
  return unwrap(
    clientApiPost<Envelope<InviteLeadResult>>(
      `/api/recruitment/leads/${leadId}/invite`,
      body,
    ),
  );
}

export async function createManualCandidate(input: {
  name: string;
  email: string;
  jobProfileId: string;
  slotId?: string;
  slotDate?: string;
  resume?: File | null;
}) {
  const form = new FormData();
  form.set('name', input.name);
  form.set('email', input.email);
  form.set('job_profile_id', input.jobProfileId);
  if (input.slotId) form.set('slot_id', input.slotId);
  if (input.slotDate) form.set('slot_date', input.slotDate);
  if (input.resume) form.set('resume', input.resume);
  const path = '/api/recruitment/candidates';
  const res = await authedFetch(path, { method: 'POST', body: form });
  const text = await res.text();
  let payload: { success?: boolean; message?: string | string[]; data?: InviteLeadResult } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!res.ok || payload.success === false) {
    const raw = payload.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || text || 'Could not create candidate';
    throw new Error(message);
  }
  return payload.data as InviteLeadResult;
}

export type BulkCreateCandidateItem = {
  lead_id?: string;
  name?: string;
  resume_url?: string | null;
  error?: string;
};

export type BulkCreateCandidatesResult = {
  created: number;
  failed: number;
  items: BulkCreateCandidateItem[];
};

export async function bulkCreateCandidates(input: {
  jobProfileId: string;
  resumes: File[];
}) {
  const form = new FormData();
  form.set('job_profile_id', input.jobProfileId);
  for (const file of input.resumes) {
    form.append('resumes', file);
  }
  const res = await authedFetch('/api/recruitment/candidates/bulk', {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  let payload: {
    success?: boolean;
    message?: string | string[];
    data?: BulkCreateCandidatesResult;
  } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!res.ok || payload.success === false) {
    const raw = payload.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || text || 'Bulk upload failed';
    throw new Error(message);
  }
  return payload.data as BulkCreateCandidatesResult;
}

export type BatchInviteResult = {
  invited: number;
  skipped: number;
  results: Array<{
    lead_id: string;
    status: string;
    skipped?: boolean;
    error?: string;
    invite_token?: string;
    interview_url?: string;
  }>;
};

export function batchInviteLeads(input: {
  lead_ids?: string[];
  job_profile_id?: string;
  min_score?: number;
}) {
  return unwrap(
    clientApiPost<Envelope<BatchInviteResult>>('/api/recruitment/leads/batch-invite', {
      lead_ids: input.lead_ids ?? [],
      ...(input.job_profile_id ? { job_profile_id: input.job_profile_id } : {}),
      ...(input.min_score != null ? { min_score: input.min_score } : {}),
    }),
  );
}

export type RecruitmentTimeSlot = {
  id: string;
  label: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  capacity: number;
  booked_count: number;
  remaining: number;
  status: string;
  notes: string | null;
  display_label: string;
  created_at?: string;
  updated_at?: string;
};

export function listRecruitmentTimeSlots(opts?: {
  availableOnly?: boolean;
  forDate?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.availableOnly) params.set('available_only', '1');
  if (opts?.forDate) params.set('for_date', opts.forDate);
  const q = params.toString();
  return unwrap(
    clientApiGet<Envelope<{ items: RecruitmentTimeSlot[] }>>(
      `/api/recruitment/time-slots${q ? `?${q}` : ''}`,
    ),
  );
}

export function createRecruitmentTimeSlot(body: {
  label?: string;
  start_time: string;
  end_time: string;
  timezone?: string;
  capacity?: number;
  notes?: string;
  status?: string;
}) {
  return unwrap(
    clientApiPost<Envelope<RecruitmentTimeSlot>>('/api/recruitment/time-slots', body),
  );
}

export function updateRecruitmentTimeSlot(
  id: string,
  body: Partial<{
    label: string | null;
    start_time: string;
    end_time: string;
    timezone: string;
    capacity: number;
    notes: string | null;
    status: string;
  }>,
) {
  return unwrap(
    clientApiPatch<Envelope<RecruitmentTimeSlot>>(`/api/recruitment/time-slots/${id}`, body),
  );
}

export function deleteRecruitmentTimeSlot(id: string) {
  return clientApiDelete(`/api/recruitment/time-slots/${id}`).then(() => ({
    id,
    deleted: true as const,
  }));
}

export type BulkInviteResult = {
  invited: number;
  failed: number;
  skipped: number;
  invalid_count?: number;
  total_capacity?: number;
  allocation?: Array<{
    slot_id: string;
    slot_label: string;
    assigned: number;
    remaining?: number;
  }>;
  items: Array<{
    email: string;
    lead_id?: string;
    status: string;
    invite_token?: string;
    interview_url?: string;
    email_sent?: boolean;
    slot_id?: string;
    slot_label?: string;
    error?: string;
  }>;
};

export function bulkInviteCandidates(input: {
  emails: string[];
  jobProfileId: string;
  slotDate: string;
}) {
  return unwrap(
    clientApiPost<Envelope<BulkInviteResult>>('/api/recruitment/candidates/bulk-invite', {
      emails: input.emails,
      job_profile_id: input.jobProfileId,
      slot_date: input.slotDate,
    }),
  );
}

export function listRecruitmentInterviews(input?: Record<string, string>) {
  return unwrap(
    clientApiPost<
      Envelope<{
        items: RecruitmentInterviewItem[];
        total: number;
        stats: { status_counts: Record<string, number> };
      }>
    >('/api/recruitment/interviews', input ?? {}),
  );
}

export type AdminInterviewMonitorJoin = {
  livekitToken: string;
  livekitUrl: string;
  roomName: string;
  identity: string;
  candidateToken: string;
  portalToken: string;
  currentPhase: string;
  roundType: string;
  roundStatus: string | null;
  rounds: Array<{
    round_type: string;
    status: string;
    livekit_room_name: string | null;
  }>;
  participantsOnline?: string[];
  monitorMode: boolean;
  canPublish: boolean;
  candidateName?: string | null;
  resumeUrl?: string | null;
  strikeCount?: number;
  maxStrikes?: number;
  sessionStartedAt?: string | null;
};

export function createAdminInterviewMonitorJoin(token: string, roundType?: string) {
  return unwrap(
    clientApiPost<Envelope<AdminInterviewMonitorJoin>>(
      `/api/autonomous-interview/admin/monitor/${encodeURIComponent(token)}`,
      roundType ? { round_type: roundType } : {},
    ),
  );
}

export type ProjectInterviewEvalStatus = {
  status: string;
  fallback_active: boolean;
  evaluation_fallback_level?: string;
  eval_duration_sec: number;
  can_force_advance: boolean;
  interview_token: string | null;
  interview_questions_locked?: boolean;
};

export function getProjectInterviewEvalStatus(token: string) {
  return unwrap(
    clientApiGet<Envelope<ProjectInterviewEvalStatus>>(
      `/api/project-interview/admin/eval-status/${encodeURIComponent(token)}`,
    ),
  );
}

export function forceAdvanceProjectInterview(token: string) {
  return unwrap(
    clientApiPost<Envelope<{ success: boolean; new_status: string; interview_token?: string | null }>>(
      `/api/project-interview/admin/force-advance/${encodeURIComponent(token)}`,
      {},
    ),
  );
}

export function rescoreProjectInterviewCode(
  submissionId: string,
  body?: { github_url?: string; github_branch?: string },
) {
  return unwrap(
    clientApiPost<Envelope<{ success: boolean; submission_id: string; github_url: string | null; message: string }>>(
      `/api/project-interview/admin/rescore-code/${encodeURIComponent(submissionId)}`,
      body ?? {},
    ),
  );
}

export function getTodayInterviews() {
  return unwrap(
    clientApiGet<Envelope<{ items: RecruitmentInterviewItem[] }>>('/api/recruitment/interviews/today'),
  );
}

export function getRecruitmentInterview(id: string) {
  return unwrap(clientApiGet<Envelope<Record<string, unknown>>>(`/api/recruitment/interviews/${id}`));
}

export function updateInterviewStatus(
  id: string,
  body: {
    portal_status: string;
    reason?: string;
    result?: string;
    remark?: string;
    no_show_reason?: string;
    reschedule_reason?: string;
    cancel_reason?: string;
  },
) {
  return unwrap(
    clientApiPatch<Envelope<unknown>>(`/api/recruitment/interviews/${id}/status`, body),
  );
}

export function updateInterviewChecklist(
  id: string,
  body: Record<string, boolean>,
) {
  return unwrap(
    clientApiPatch<Envelope<unknown>>(`/api/recruitment/interviews/${id}/checklist`, body),
  );
}

export function draftInterviewResultAi(id: string, summary?: string) {
  return unwrap(
    clientApiPost<Envelope<Record<string, unknown>>>(
      `/api/recruitment/interviews/${id}/ai-draft-result`,
      summary ? { summary } : {},
    ),
  );
}
