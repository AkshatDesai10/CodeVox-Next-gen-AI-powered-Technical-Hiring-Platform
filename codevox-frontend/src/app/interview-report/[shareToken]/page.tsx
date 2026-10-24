'use client';

import { use, useEffect, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { getSharedInterviewReport } from '@/modules/autonomous-interview/lib/interview-report-api';
import type { SharedInterviewExecutiveCard } from '@/modules/autonomous-interview/types/interview-report';

export default function PublicInterviewReportPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = use(params);
  const [data, setData] = useState<SharedInterviewExecutiveCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSharedInterviewReport(decodeURIComponent(shareToken))
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Report unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--assessment-surface,#f5f7fa)] p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--assessment-primary,#3b82f6)] border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--assessment-surface,#f5f7fa)] p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-950">
          <AssessmentMaterialIcon name="link_off" size={28} className="mx-auto text-amber-700" />
          <h1 className="mt-3 text-lg font-bold">Shared report unavailable</h1>
          <p className="mt-2 text-sm text-amber-900/80">
            {error ?? 'This link is invalid or the interview report is not ready yet.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--assessment-surface,#f5f7fa)] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--assessment-on-surface-variant,#64748b)]">
          <AssessmentMaterialIcon name="share" size={16} />
          Shared interview summary
        </div>

        <article className="overflow-hidden rounded-2xl border border-[var(--assessment-outline-variant,#e2e8f0)] bg-white shadow-sm">
          <div className="border-b border-[var(--assessment-outline-variant,#e2e8f0)] bg-[var(--assessment-primary,#1d3054)] px-6 py-5 text-white">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              CodeVox Assessment
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight">
              {data.candidateName ?? 'Candidate'}
            </h1>
            <p className="mt-1 text-sm text-white/80">
              {data.techStack ?? 'AI Interview'}
              {data.finalizedAt
                ? ` · ${new Date(data.finalizedAt).toLocaleString()}`
                : ''}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 border-b border-[var(--assessment-outline-variant,#e2e8f0)] px-6 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant,#64748b)]">
                Depth
              </p>
              <p className="text-lg font-bold tabular-nums text-[var(--assessment-on-surface,#0f172a)]">
                {data.depthScore != null ? `${data.depthScore}/10` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant,#64748b)]">
                Exchanges
              </p>
              <p className="text-lg font-bold tabular-nums text-[var(--assessment-on-surface,#0f172a)]">
                {data.turnCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant,#64748b)]">
                Decision
              </p>
              <p className="text-sm font-bold text-[var(--assessment-on-surface,#0f172a)]">
                {data.recommendation
                  ? String(data.recommendation).replace(/_/g, ' ')
                  : 'Under review'}
              </p>
            </div>
          </div>

          <div className="space-y-2 px-6 py-5">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--assessment-primary,#1d3054)]">
              <AssessmentMaterialIcon name="description" size={16} />
              Executive summary
            </h2>
            <p className="text-sm leading-relaxed text-[var(--assessment-on-surface,#0f172a)]">
              {data.executiveSummary}
            </p>
          </div>
        </article>

        <p className="text-center text-[11px] text-[var(--assessment-on-surface-variant,#64748b)]">
          Read-only share link. Full transcript and recordings require recruiter access.
        </p>
      </div>
    </div>
  );
}
