import { recruitmentApiBase } from '@/lib/recruitment-api-base';

const API_BASE = () => recruitmentApiBase();

type ApiEnvelope<T> = { success: boolean; message: string; data: T };

export type ProjectInterviewStatus =
  | 'pending_submission'
  | 'in_build'
  | 'evaluating_code'
  | 'ready_for_interview'
  | 'completed'
  | 'expired';

export type CandidateProjectChoice = {
  id: string;
  title: string;
  description_md: string;
  twist_requirement: string | null;
  must_have_requirements: Array<{ id: string; text: string }>;
  tech_stack: { mode: 'mandatory' | 'allowed' | 'free_choice'; languages_frameworks: string[] };
  deliverables: {
    require_readme: boolean;
    require_decisions_md: boolean;
    require_tests: boolean;
    run_instructions_required: boolean;
  };
  duration_hours: number;
  submission_type: 'github_url' | 'zip_upload' | 'excel_or_pdf';
  assessment_document?: { filename: string; file_url: string } | null;
  supporting_datasets?: Array<{ filename: string; file_url: string }>;
  attached_documents: string[];
  category: string | null;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | null;
};

export type ProjectInterviewCandidateView = {
  submission_token: string;
  portal_token: string | null;
  status: ProjectInterviewStatus;
  stage_name: string;
  job_title: string | null;
  max_assessment_hours: number;
  selection_started_at: string | null;
  selection_countdown_seconds: number;
  projects: CandidateProjectChoice[];
  selected_project_id: string | null;
  selected_project: CandidateProjectChoice | null;
  selected_at: string | null;
  due_at: string | null;
  github_url: string | null;
  github_branch: string | null;
  submitted_at: string | null;
  last_error: string | null;
  interview: { question_count: number; duration_minutes: number };
  build_session_token: string | null;
  interview_token: string | null;
  result: {
    pending: boolean;
    score_pct: number | null;
    outcome: 'advanced' | 'completed' | 'eliminated' | null;
  } | null;
};

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  throw new Error(message ?? fallback);
}

const submissionUrl = (token: string, suffix = '') =>
  `${API_BASE()}/api/project-interview/submissions/${encodeURIComponent(token)}${suffix}`;

export async function getProjectInterviewSubmission(token: string): Promise<ProjectInterviewCandidateView> {
  const res = await fetch(submissionUrl(token), { cache: 'no-store' });
  if (!res.ok) await readError(res, 'Failed to load Build & Defend round');
  return ((await res.json()) as ApiEnvelope<ProjectInterviewCandidateView>).data;
}

export async function selectProjectInterviewProject(
  token: string,
  projectId: string,
): Promise<ProjectInterviewCandidateView> {
  const res = await fetch(submissionUrl(token, '/select'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!res.ok) await readError(res, 'Could not select project');
  return ((await res.json()) as ApiEnvelope<ProjectInterviewCandidateView>).data;
}

export async function submitProjectInterviewRepo(
  token: string,
  input: { github_url: string; github_branch?: string },
): Promise<ProjectInterviewCandidateView> {
  const res = await fetch(submissionUrl(token, '/submit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      github_url: input.github_url,
      github_branch: input.github_branch || undefined,
    }),
  });
  if (!res.ok) await readError(res, 'Submission failed');
  return ((await res.json()) as ApiEnvelope<ProjectInterviewCandidateView>).data;
}

export async function submitProjectInterviewZip(
  token: string,
  file: File,
): Promise<ProjectInterviewCandidateView> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(submissionUrl(token, '/submit-zip'), { method: 'POST', body });
  if (!res.ok) await readError(res, 'Submission failed');
  return ((await res.json()) as ApiEnvelope<ProjectInterviewCandidateView>).data;
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utf[1].trim().replace(/^"|"$/g, '');
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim().replace(/^"|"$/g, '') || null;
}

function extensionForContentType(contentType: string | null): string {
  const ct = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct.includes('spreadsheetml') || ct.includes('ms-excel')) return '.xlsx';
  if (ct === 'application/pdf') return '.pdf';
  if (ct.includes('wordprocessingml')) return '.docx';
  if (ct === 'application/zip' || ct === 'application/x-zip-compressed') return '.zip';
  return '';
}

export async function downloadProjectInterviewFiles(token: string, projectId: string): Promise<void> {
  const res = await fetch(
    submissionUrl(token, `/projects/${encodeURIComponent(projectId)}/files`),
    { cache: 'no-store' },
  );
  if (!res.ok) await readError(res, 'Could not download assessment files');
  const blob = await res.blob();
  const fromHeader = filenameFromContentDisposition(res.headers.get('Content-Disposition'));
  const contentType = res.headers.get('Content-Type');
  let filename = fromHeader?.trim() || '';
  if (!filename) {
    const ext = extensionForContentType(contentType) || extensionForContentType(blob.type);
    // Never default Excel/PDF bytes to .zip — that opens as _rels/docProps/xl junk.
    filename = ext === '.zip' ? 'assessment-files.zip' : `assessment${ext || '.bin'}`;
  } else if (!/\.[a-z0-9]{1,8}$/i.test(filename)) {
    const ext = extensionForContentType(contentType) || extensionForContentType(blob.type);
    if (ext) filename = `${filename}${ext}`;
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function getProjectInterviewReport(applicationId: string, stageId: string) {
  const { getSession } = await import('next-auth/react');
  const session = await getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sign in required');
  const res = await fetch(
    `${API_BASE()}/api/project-interview/applications/${applicationId}/stages/${stageId}/report`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) await readError(res, 'Failed to load report');
  return ((await res.json()) as ApiEnvelope<unknown>).data;
}
