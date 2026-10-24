import { clientApiGet, clientApiPost } from '@/lib/client-api';
import type {
  AssessmentReportDetail,
  AssessmentReportsListFilters,
  AssessmentReportsListResponse,
  AssessmentReportsSummary,
  OverallEvaluation,
} from '../types/assessment-report';

type ApiEnvelope<T> = { success: boolean; message: string; data: T };

function toQuery(filters: AssessmentReportsListFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.jobProfileId) params.set('jobProfileId', filters.jobProfileId);
  if (filters.stageType) params.set('stageType', filters.stageType);
  if (filters.status) params.set('status', filters.status);
  if (filters.minScore != null) params.set('minScore', String(filters.minScore));
  if (filters.maxScore != null) params.set('maxScore', String(filters.maxScore));
  if (filters.page != null) params.set('page', String(filters.page));
  if (filters.pageSize != null) params.set('pageSize', String(filters.pageSize));
  if (filters.windowDays != null) params.set('windowDays', String(filters.windowDays));
  if (filters.windowField) params.set('windowField', filters.windowField);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listAssessmentReports(
  filters: AssessmentReportsListFilters = {},
): Promise<AssessmentReportsListResponse> {
  const res = await clientApiGet<ApiEnvelope<AssessmentReportsListResponse>>(
    `/api/assessment-reports${toQuery(filters)}`,
  );
  return res.data;
}

export async function getAssessmentReportsSummary(
  filters: AssessmentReportsListFilters = {},
): Promise<AssessmentReportsSummary> {
  const { page: _p, pageSize: _ps, ...rest } = filters;
  const res = await clientApiGet<ApiEnvelope<AssessmentReportsSummary>>(
    `/api/assessment-reports/summary${toQuery(rest)}`,
  );
  return res.data;
}

export async function getBulkProfilesStats(
  jobProfileIds: string[],
): Promise<Record<string, AssessmentReportsSummary>> {
  if (!jobProfileIds.length) return {};
  const res = await clientApiGet<ApiEnvelope<Record<string, AssessmentReportsSummary>>>(
    `/api/assessment-reports/stats/bulk?ids=${encodeURIComponent(jobProfileIds.join(','))}`,
  );
  return res.data;
}

export async function getAssessmentReport(
  applicationId: string,
): Promise<AssessmentReportDetail> {
  const res = await clientApiGet<ApiEnvelope<AssessmentReportDetail>>(
    `/api/assessment-reports/${encodeURIComponent(applicationId)}`,
  );
  return res.data;
}

export async function applyIntegrityOverride(
  applicationId: string,
  action: 'disqualify' | 'allow_retake',
  note?: string,
): Promise<{ success: boolean; action: string; integrityOverride: unknown }> {
  const res = await clientApiPost<ApiEnvelope<{ success: boolean; action: string; integrityOverride: unknown }>>(
    `/api/assessment-reports/${encodeURIComponent(applicationId)}/integrity-override`,
    { action, note },
  );
  return res.data;
}

export async function regenerateOverallEvaluation(
  applicationId: string,
  force = true,
): Promise<OverallEvaluation | null> {
  const res = await clientApiPost<ApiEnvelope<OverallEvaluation | null>>(
    `/api/assessment-reports/${encodeURIComponent(applicationId)}/overall-evaluation`,
    { force },
  );
  return res.data;
}
