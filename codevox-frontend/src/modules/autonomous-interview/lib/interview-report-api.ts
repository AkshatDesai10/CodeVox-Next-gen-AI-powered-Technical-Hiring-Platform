import { clientApiGet } from '@/lib/client-api';
import type {
  InterviewAuditSummary,
  InterviewReportResponse,
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
