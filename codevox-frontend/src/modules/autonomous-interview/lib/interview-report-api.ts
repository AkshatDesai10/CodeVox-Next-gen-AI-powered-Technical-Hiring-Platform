import { clientApiGet } from '@/lib/client-api';
import { recruitmentApiBase } from '@/lib/recruitment-api-base';
import type {
  InterviewAuditSummary,
  InterviewReportResponse,
  SharedInterviewExecutiveCard,
} from '@/modules/autonomous-interview/types/interview-report';

type ApiEnvelope<T> = { success: boolean; message: string; data: T };

export function listInterviewReports() {
  return clientApiGet<ApiEnvelope<InterviewAuditSummary[]>>(
    '/api/autonomous-interview/admin/reports',
  );
}

export function getInterviewReport(token: string, filename?: string) {
  const path = filename
    ? `/api/autonomous-interview/admin/reports/${encodeURIComponent(token)}/${encodeURIComponent(filename)}`
    : `/api/autonomous-interview/admin/reports/${encodeURIComponent(token)}`;
  return clientApiGet<ApiEnvelope<InterviewReportResponse>>(path);
}

/** Public executive card — no admin JWT (HMAC share token). */
export async function getSharedInterviewReport(shareToken: string) {
  const res = await fetch(
    `${recruitmentApiBase()}/api/autonomous-interview/reports/share/${encodeURIComponent(shareToken)}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Shared report failed (${res.status})`);
  }
  return (await res.json()) as ApiEnvelope<SharedInterviewExecutiveCard>;
}
