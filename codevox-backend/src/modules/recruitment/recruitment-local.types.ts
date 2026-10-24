/** Local lead / interview row shapes used by recruitment APIs. */

export type LocalLeadCourse = {
  lead_id?: string;
  course_id?: string;
  course_name?: string;
};

export type LocalLeadDocument = {
  lead_id?: string;
  document_name?: string;
  document_url?: string;
  document_status?: string;
};

export type LocalLeadRow = {
  id: string;
  lead_id: string;
  firstname: string;
  middlename: string | null;
  lastname: string | null;
  email: string;
  phoneno: string | null;
  whatsappnumber: string | null;
  lead_type: string | null;
  lead_stage: string | null;
  lead_sub_stage: string | null;
  priority: string | null;
  acad_year: string | null;
  created_at: string | null;
  counselor_id: string | null;
  lead_source: string | null;
  lead_sub_source: string | null;
  lead_score: number | null;
  duplicate_strength: number | null;
  duplicate_match_count: number | null;
  verified_lead: number | null;
  corr_country: string | null;
  corr_state: string | null;
  corr_city: string | null;
  gender: string | null;
  nationality: string | null;
  form_step_name: string | null;
  form_completed: number | null;
  lead_courses: LocalLeadCourse[];
  document_uploads: LocalLeadDocument[];
  educational_details: unknown[];
  leads_answers: Record<string, string> | null;
  resume_url: string | null;
  experience_years: number | null;
  current_company: string | null;
  notice_period_days: number | null;
  raw: Record<string, unknown>;
};

export type LocalInterviewRow = {
  id: string;
  lead_id: string;
  remarks_desc: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  interview_type: string | null;
  interview_mode: string | null;
  interview_status: string | null;
  meeting_url: string | null;
  interview_result: string | null;
  interview_remark: string | null;
  acad_year: string | null;
  created_by_name: string | null;
  created_date: string | null;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phoneno: string | null;
  course_name: string | null;
  profile_image_url: string | null;
  raw: Record<string, unknown>;
};

export const INBOX_PIPELINE_STAGES = [
  'New',
  'Qualified',
  'Scheduled',
  'Interviewed',
  'Offered',
  'Hired',
  'Rejected',
  'On Hold',
] as const;
