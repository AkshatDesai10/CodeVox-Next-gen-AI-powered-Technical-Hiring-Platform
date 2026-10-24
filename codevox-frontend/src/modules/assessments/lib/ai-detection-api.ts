import { getSession, signIn } from 'next-auth/react';

import { recruitmentApiBase } from '@/lib/recruitment-api-base';

const API_BASE = () => recruitmentApiBase();

export type AiDetectionReport = {
  id: string;
  examiner_name: string | null;
  source_type: 'file' | 'text';
  document_title: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  char_count: number;
  chunk_count: number;
  verdict: string | null;
  confidence: number | null;
  ai_probability: number | null;
  human_probability: number | null;
  analysis: {
    perplexity: number | null;
    burstiness: number | null;
    entropy: number | null;
    classifier_score: number | null;
  };
  flagged_segments: unknown[];
  text_preview: string | null;
  provider_id: string | null;
  created_at: string;
};

type ApiEnvelope<T> = { success: boolean; message: string; data: T };

async function aiDetectionToken(): Promise<string> {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) {
    await signIn(undefined, { callbackUrl: '/', redirect: true });
    throw new Error('Missing access token');
  }
  return token;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  throw new Error(body.message ?? fallback);
}

export async function analyzeProjectReport(input: {
  file?: File | null;
  text?: string;
  title?: string;
}): Promise<AiDetectionReport> {
  const token = await aiDetectionToken();
  const form = new FormData();
  if (input.file) form.append('file', input.file);
  if (input.text?.trim()) form.append('text', input.text.trim());
  if (input.title?.trim()) form.append('title', input.title.trim());

  const res = await fetch(`${API_BASE()}/api/ai-detection/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) await readError(res, 'Failed to analyze report');
  const json = (await res.json()) as ApiEnvelope<AiDetectionReport>;
  return json.data;
}

export async function listAiDetectionReports(): Promise<AiDetectionReport[]> {
  const token = await aiDetectionToken();
  const res = await fetch(`${API_BASE()}/api/ai-detection/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) await readError(res, 'Failed to load detection history');
  const json = (await res.json()) as ApiEnvelope<AiDetectionReport[]>;
  return json.data ?? [];
}
