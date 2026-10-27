import { clientApiPost, authedFetch } from './client-api';
import { recruitmentApiBase } from './recruitment-api-base';

export async function getCandidateDashboard(token: string) {
  // Candidate portal does not use next-auth, the token in URL is their authentication
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/${token}/dashboard`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load dashboard: ${text}`);
  }

  return res.json();
}

export async function onboardCandidate(
  token: string,
  input: { name: string; resume?: File | null },
) {
  const form = new FormData();
  form.set('name', input.name);
  if (input.resume) form.append('resume', input.resume);

  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/${token}/onboard`, {
    method: 'POST',
    body: form,
  });

  const text = await res.text().catch(() => '');
  let payload: { success?: boolean; message?: string | string[]; data?: unknown } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!res.ok || payload.success === false) {
    const raw = payload.message;
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : raw || text || 'Failed to complete onboarding';
    throw new Error(message);
  }

  return payload.data;
}

export async function saveCandidatePortalPreferences(
  token: string,
  body: { interview_language?: 'en' | 'hi'; accept_guidelines?: boolean },
) {
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/${token}/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to save preferences');
  }
  return res.json();
}

export async function recordCandidateFaceConsent(token: string) {
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/${token}/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to record consent');
  }
  return res.json();
}

export async function captureCandidateFace(
  token: string,
  body: { image_base64: string; face_descriptor?: number[] | null },
) {
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/${token}/face-capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to capture face photo');
  }
  return res.json();
}

export async function createDemoApplication(
  jobProfileId: string,
  candidateName: string,
  candidateEmail: string,
  resumeFile?: File | null
) {
  const formData = new FormData();
  formData.append('job_profile_id', jobProfileId);
  formData.append('candidate_name', candidateName);
  formData.append('candidate_email', candidateEmail);
  if (resumeFile) {
    formData.append('resume', resumeFile);
  }

  // Direct fetch — no auth needed, demo-link is a public route
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/demo-link`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create demo link: ${text}`);
  }

  return { data: await res.json() };
}

export function getCodingProblem(token: string) {
  return fetch(`${recruitmentApiBase()}/api/coding-round/${token}`, {
    cache: 'no-store',
  }).then((r) => r.json());
}

export function runCodingCode(token: string, problemId: string, language: string, sourceCode: string) {
  return fetch(`${recruitmentApiBase()}/api/coding-round/${token}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id: problemId, language, source_code: sourceCode }),
  }).then((r) => r.json());
}

export function submitCodingCode(token: string, submissions: Record<string, { language: string; source_code: string }>) {
  return fetch(`${recruitmentApiBase()}/api/coding-round/${token}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submissions }),
  }).then((r) => r.json());
}

export type PortalRuntimeConfig = {
  face: 'on' | 'off';
  maxStrikes: number;
  autoSubmitOnStrike: boolean;
  graceSeconds: number;
};

export async function getPortalRuntimeConfig(): Promise<PortalRuntimeConfig> {
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/runtime-config`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to load runtime config: ${text}`);
  }
  const payload = (await res.json()) as {
    success?: boolean;
    data?: PortalRuntimeConfig;
  } & Partial<PortalRuntimeConfig>;
  const data = payload.data ?? payload;
  return {
    face: data.face === 'off' ? 'off' : 'on',
    maxStrikes: Number(data.maxStrikes) || 5,
    autoSubmitOnStrike: Boolean(data.autoSubmitOnStrike),
    graceSeconds: Number(data.graceSeconds) || 90,
  };
}

