import type { ProctorEventInput } from '@/modules/proctor/types';

import { recruitmentApiBase } from '@/lib/recruitment-api-base';

const API_BASE = () => recruitmentApiBase();

export type { ProctorEventInput };

export type AutonomousSession = {
  candidateToken: string;
  currentPhase: string;
  candidateAssessmentId: string | null;
  techStack: string | null;
  stage1VoiceScore?: number;
  codeQualityScore?: number | null;
  finalDecision?: string;
  introAgentTurns?: number;
  introUserTurns?: number;
  introMinTurns?: number;
  introMaxTurns?: number;
  introChatHistory?: { role: string; content: string }[];
  consentText?: string | null;
  consentRecordedAt?: string | null;
  identityVerifiedAt?: string | null;
  livenessVerifiedAt?: string | null;
  referenceFaceDescriptor?: number[] | null;
  voiceEnrolled?: boolean;
  proctorConfig?: {
    faceCheckIntervalMs: number;
    faceMatchThreshold: number;
    requireCameraForStart: boolean;
    requireVoiceEnroll: boolean;
  };
  livenessProvider?: 'challenge' | 'vendor';
  proctorSummary?: Record<string, unknown> | null;
  candidateName?: string | null;
};

export type InitSessionResponse = {
  candidateToken: string;
  currentPhase: string;
  livekitToken: string;
  livekitUrl: string;
  roomName: string;
  candidateAssessmentId: string | null;
};

type Envelope<T> = { success: boolean; message: string; data: T };

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const json = (await res.json()) as Envelope<T>;
  return json.data;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  const json = (await res.json()) as Envelope<T>;
  return json.data;
}

export function viewportWsUrl() {
  const base = API_BASE().replace(/^http/, 'ws');
  return `${base}/api/autonomous-interview/viewport`;
}

export function getAutonomousSession(token: string) {
  return apiGet<AutonomousSession>(`/api/autonomous-interview/session/${encodeURIComponent(token)}`);
}

export function initAutonomousSession(token: string) {
  return apiPost<InitSessionResponse>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/init`,
    {},
  );
}

export type CandidateReadyResponse = {
  started: boolean;
  rejoin?: boolean;
  currentPhase?: string;
  mode: 'livekit' | 'browser';
  livekitToken?: string;
  livekitUrl?: string;
  roomName?: string;
  phase?: string;
};

const candidateReadyInflight = new Map<string, Promise<CandidateReadyResponse>>();

export function notifyCandidateReady(token: string) {
  const existing = candidateReadyInflight.get(token);
  if (existing) return existing;

  const request = apiPost<CandidateReadyResponse>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/candidate-ready`,
    {},
  ).finally(() => {
    candidateReadyInflight.delete(token);
  });

  candidateReadyInflight.set(token, request);
  return request;
}

export type VoiceMessageResponse = {
  reply: string;
  complete: boolean;
  agentTurns: number;
  userTurns?: number;
  minTurns?: number;
  maxTurns?: number;
  currentPhase: string;
  voiceIntroComplete?: boolean;
};

export function sendVoiceMessage(token: string, message: string) {
  return apiPost<VoiceMessageResponse>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/voice-message`,
    { message },
  );
}

export function finalSubmitAutonomous(params: {
  candidate_token: string;
  source_code: string;
  language?: string;
}) {
  return apiPost<Record<string, unknown>>('/api/autonomous-interview/final-submit', params);
}

export function forceCompleteAutonomous(
  token: string,
  body?: { endedBy?: 'candidate' },
) {
  return apiPost<Record<string, unknown>>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/force-complete`,
    body?.endedBy ? { ended_by: body.endedBy } : {},
  );
}

/** Intentional Leave Build before GitHub submit. Disconnect must not call this. */
export function leaveBuildWithoutSubmission(sessionToken: string) {
  return fetch(
    `${API_BASE()}/api/project-interview/sessions/${encodeURIComponent(sessionToken)}/leave-build`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'intentional_end' }),
    },
  ).then(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return (json?.data ?? json) as {
      finalized?: boolean;
      reason?: string;
      status?: string;
    };
  });
}

export function recordInterviewConsent(token: string) {
  return apiPost<{ consent_recorded_at: string }>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/consent`,
    {},
  );
}

export function verifyInterviewIdentity(
  token: string,
  body: { descriptor: number[]; capture_quality?: number },
) {
  return apiPost<{ verified: boolean; identity_verified_at: string }>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/identity-verify`,
    body,
  );
}

export function verifyInterviewLiveness(
  token: string,
  body: {
    challenge_id: string;
    passed: boolean;
    motion_score?: number;
    steps_completed?: string[];
    vendor_session_id?: string;
  },
) {
  return apiPost<{ verified: boolean; liveness_verified_at: string }>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/liveness-verify`,
    body,
  );
}

export function enrollInterviewVoice(token: string, body: { audio_base64: string }) {
  return apiPost<{ enrolled: boolean }>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/voice-enroll`,
    body,
  );
}

export function checkInterviewVoice(
  token: string,
  body: { audio_base64: string; phase?: string },
) {
  return apiPost<{ match: boolean; distance: number }>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/voice-check`,
    body,
  );
}

export function postInterviewProctorEvents(token: string, events: ProctorEventInput[]) {
  return apiPost<{ ingested: number }>(
    `/api/autonomous-interview/session/${encodeURIComponent(token)}/proctor-events`,
    { events },
  );
}
