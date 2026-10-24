'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { listJobProfiles } from '@/modules/job-profiles/lib/job-profiles-api';
import {
  getAssessmentReportsSummary,
  listAssessmentReports,
} from '../lib/assessment-report-api';
import type { AssessmentReportsListFilters } from '../types/assessment-report';
import { downloadCsv, formatDate, formatRelative } from '../utils/format';
import { OverallScoreCell } from '../components/list/OverallScoreCell';
import {
  RecommendationBadge,
  ReportStatusBadge,
} from '../components/list/ReportStatusBadge';
import {
  ReportsFilterBar,
  type ReportsFilterState,
} from '../components/list/ReportsFilterBar';
import { ReportsEmptyState } from '../components/list/ReportsEmptyState';
import { ReportsKpiCards } from '../components/list/ReportsKpiCards';
import { RoundsSummaryPills } from '../components/list/RoundsSummaryPills';

const DEFAULT_FILTERS: ReportsFilterState = {
  q: '',
  jobProfileId: '',
  stageType: '',
  status: '',
  minScore: 0,
  maxScore: 100,
  compact: false,
  datePreset: 'all',
  startDate: '',
  endDate: '',
  dateField: 'appliedAt',
};

export function AssessmentReportsPage() {
  const [uiFilters, setUiFilters] = useState<ReportsFilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(uiFilters.q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [uiFilters.q]);

  const apiFilters: AssessmentReportsListFilters = useMemo(
    () => {
      let windowDays: number | undefined = undefined;
      let startDate: string | undefined = undefined;
      let endDate: string | undefined = undefined;

      if (uiFilters.datePreset === 'custom') {
        startDate = uiFilters.startDate || undefined;
        endDate = uiFilters.endDate || undefined;
      } else if (uiFilters.datePreset !== 'all') {
        const days = Number(uiFilters.datePreset);
        if (Number.isFinite(days) && days > 0) {
          windowDays = days;
        }
      }

      return {
        q: debouncedQ || undefined,
        jobProfileId: uiFilters.jobProfileId || undefined,
        stageType: uiFilters.stageType || undefined,
        status: uiFilters.status || undefined,
        minScore: uiFilters.minScore > 0 ? uiFilters.minScore : undefined,
        maxScore: uiFilters.maxScore < 100 ? uiFilters.maxScore : undefined,
        windowDays,
        startDate,
        endDate,
        windowField: uiFilters.dateField,
        page,
        pageSize,
      };
    },
    [
      debouncedQ,
      uiFilters.jobProfileId,
      uiFilters.stageType,
      uiFilters.status,
      uiFilters.minScore,
      uiFilters.maxScore,
      uiFilters.datePreset,
      uiFilters.startDate,
      uiFilters.endDate,
      uiFilters.dateField,
      page,
      pageSize,
    ],
  );

  const profilesQuery = useQuery({
    queryKey: ['job-profiles-for-reports'],
    queryFn: async () => {
      const res = await listJobProfiles({ pageSize: 100 });
      return (res.items ?? []).map((p) => ({ id: String(p.id), title: p.title }));
    },
  });

  const listQuery = useQuery({
    queryKey: ['assessment-reports', apiFilters],
    queryFn: () => listAssessmentReports(apiFilters),
  });

  const summaryQuery = useQuery({
    queryKey: ['assessment-reports-summary', apiFilters],
    queryFn: () => getAssessmentReportsSummary(apiFilters),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const profileLabel = uiFilters.jobProfileId
    ? profilesQuery.data?.find((p) => p.id === uiFilters.jobProfileId)?.title
    : null;

  const dateFilterLabel = useMemo(() => {
    if (uiFilters.datePreset === 'all') return null;
    const fieldLabel = uiFilters.dateField === 'updatedAt' ? 'Updated' : 'Applied';
    if (uiFilters.datePreset === 'custom') {
      if (uiFilters.startDate && uiFilters.endDate) {
        return `${fieldLabel}: ${uiFilters.startDate} to ${uiFilters.endDate}`;
      }
      if (uiFilters.startDate) return `${fieldLabel} after ${uiFilters.startDate}`;
      if (uiFilters.endDate) return `${fieldLabel} before ${uiFilters.endDate}`;
      return `${fieldLabel} custom range`;
    }
    const daysMap: Record<string, string> = {
      '1': 'Today',
      '7': 'Last 7 days',
      '14': 'Last 14 days',
      '30': 'Last 30 days',
      '90': 'Last 90 days',
    };
    return `${fieldLabel}: ${daysMap[uiFilters.datePreset] ?? `${uiFilters.datePreset} days`}`;
  }, [uiFilters.datePreset, uiFilters.startDate, uiFilters.endDate, uiFilters.dateField]);

  const filteredLabel = [profileLabel, dateFilterLabel].filter(Boolean).join(' · ') || null;

  const clearFilters = () => {
    setUiFilters(DEFAULT_FILTERS);
    setDebouncedQ('');
    setPage(1);
  };

  const exportCsv = () => {
    downloadCsv(
      'assessment-reports.csv',
      items.map((row) => ({
        candidate: row.candidate.name,
        email: row.candidate.email,
        job_profile: row.jobProfile.title,
        overall_score: row.overallScorePct,
        report_status: row.reportStatus,
        recommendation: row.recommendation,
        applied_at: row.appliedAt,
        updated_at: row.updatedAt,
        rounds: row.roundsSummary
          .map((r) => `${r.label}:${r.scorePct ?? r.status}`)
          .join(' | '),
      })),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--assessment-on-surface)]">
            Assessment reports
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--assessment-on-surface-variant)]">
            Scores, stage results, and hiring recommendations for each candidate.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm font-medium text-[var(--assessment-on-surface)]"
        >
          <AssessmentMaterialIcon name="download" size={18} />
          Export CSV
        </button>
      </div>

      <ReportsKpiCards summary={summaryQuery.data} loading={summaryQuery.isLoading} />

      <ReportsFilterBar
        value={uiFilters}
        onChange={(next) => {
          setUiFilters(next);
          setPage(1);
        }}
        jobProfiles={profilesQuery.data ?? []}
        resultCount={total}
        filteredLabel={filteredLabel}
        onClear={clearFilters}
      />

      <div className="assessment-card overflow-hidden">
        {listQuery.isLoading ? (
          <div className="p-8 text-sm text-[var(--assessment-on-surface-variant)]">
            Loading reports...
          </div>
        ) : listQuery.error ? (
          <div className="p-8 text-sm text-rose-600">
            Failed to load assessment reports. Ensure the API is running.
          </div>
        ) : items.length === 0 ? (
          <ReportsEmptyState onReset={clearFilters} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table
                className={`min-w-full text-sm ${uiFilters.compact ? '[&_td]:py-2 [&_th]:py-2' : ''}`}
              >
                <thead className="bg-[var(--assessment-surface-container)] text-left text-xs text-[var(--assessment-on-surface-variant)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Candidate</th>
                    <th className="px-4 py-3 font-medium">Job profile</th>
                    <th className="px-4 py-3 font-medium">Rounds</th>
                    <th className="px-4 py-3 font-medium">Overall</th>
                    <th className="px-4 py-3 font-medium">Resume</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Recommendation</th>
                    <th className="px-4 py-3 font-medium">Applied</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.applicationId}
                      className="border-t border-[var(--assessment-outline-variant)]/40 transition-colors hover:bg-[var(--assessment-surface-container)]/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-primary-container)] text-xs font-semibold text-[var(--assessment-primary)]">
                            {row.candidate.initials}
                          </div>
                          <div>
                            <div className="font-semibold text-[var(--assessment-on-surface)]">
                              {row.candidate.name}
                            </div>
                            <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                              {row.candidate.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.jobProfile.title}</div>
                        {row.jobProfile.requisitionLabel ? (
                          <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                            {row.jobProfile.requisitionLabel}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <RoundsSummaryPills rounds={row.roundsSummary} />
                      </td>
                      <td className="px-4 py-3">
                        <OverallScoreCell score={row.overallScorePct} />
                      </td>
                      <td className="px-4 py-3">
                        <OverallScoreCell score={row.resumeScore} />
                      </td>
                      <td className="px-4 py-3">
                        <ReportStatusBadge status={row.reportStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <RecommendationBadge recommendation={row.recommendation} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-[var(--assessment-on-surface-variant)]">
                        {formatDate(row.appliedAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-[var(--assessment-on-surface-variant)]">
                        {formatRelative(row.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/assessments/assessment-reports/${encodeURIComponent(row.applicationId)}`}
                          className="inline-flex rounded-lg bg-[var(--assessment-primary)] px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--assessment-outline-variant)]/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                Page {page} of {totalPages} · {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded-md border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-2 py-1 text-xs"
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-[var(--assessment-outline-variant)] px-2.5 py-1 text-xs disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-md border border-[var(--assessment-outline-variant)] px-2.5 py-1 text-xs disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
