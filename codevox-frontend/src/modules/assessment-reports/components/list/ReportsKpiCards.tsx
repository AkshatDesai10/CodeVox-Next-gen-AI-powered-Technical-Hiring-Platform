'use client';

import type { AssessmentReportsSummary } from '../../types/assessment-report';

export function ReportsKpiCards(props: {
  summary?: AssessmentReportsSummary | null;
  loading?: boolean;
}) {
  const s = props.summary;
  const cards = [
    {
      label: 'Active candidates',
      value: props.loading ? '—' : String(s?.activeCandidates ?? 0),
      accent: 'bg-sky-500',
    },
    {
      label: 'Average score',
      value: props.loading
        ? '—'
        : s?.avgCohortScorePct != null
          ? `${s.avgCohortScorePct}%`
          : '—',
      accent: 'bg-[var(--assessment-primary)]',
    },
    {
      label: 'Strong hire',
      value: props.loading ? '—' : String(s?.strongHireCount ?? 0),
      accent: 'bg-emerald-600',
    },
    {
      label: 'Pending review',
      value: props.loading ? '—' : String(s?.pendingReviewCount ?? 0),
      accent: 'bg-amber-500',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article key={card.label} className="assessment-card p-4">
          <div className={`mb-3 h-1 w-8 rounded-full ${card.accent}`} />
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">{card.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{card.value}</p>
        </article>
      ))}
    </div>
  );
}
