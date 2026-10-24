'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { Recommendation, ReportStatus } from '../../types/assessment-report';
import { recommendationLabel, reportStatusLabel } from '../../utils/format';

export function ReportStatusBadge(props: { status: ReportStatus }) {
  const map: Record<ReportStatus, { cls: string; icon: string }> = {
    passed: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'check_circle' },
    completed: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'check_circle' },
    under_review: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'check_circle' },
    in_progress: { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: 'sync' },
    failed: { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'cancel' },
  };
  const m = map[props.status] || map.under_review;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${m.cls}`}
    >
      <AssessmentMaterialIcon name={m.icon} size={14} />
      {reportStatusLabel(props.status)}
    </span>
  );
}

export function RecommendationBadge(props: { recommendation: Recommendation }) {
  if (!props.recommendation) {
    return <span className="text-xs text-[var(--assessment-on-surface-variant)]">—</span>;
  }
  const map: Record<Exclude<Recommendation, null>, { cls: string; icon: string }> = {
    strong_hire: {
      cls: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      icon: 'star',
    },
    hire: { cls: 'bg-teal-50 text-teal-800 border-teal-200', icon: 'thumb_up' },
    under_review: {
      cls: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: 'hourglass_empty',
    },
    evaluating: { cls: 'bg-slate-100 text-slate-700 border-slate-200', icon: 'visibility' },
    reject: { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'block' },
    flagged: {
      cls: 'bg-amber-100 text-amber-900 border-amber-300 ring-2 ring-amber-500/20 font-bold',
      icon: 'flag',
    },
    disqualified: {
      cls: 'bg-red-100 text-red-900 border-red-400 ring-2 ring-red-500/20 font-bold',
      icon: 'cancel',
    },
    retake: {
      cls: 'bg-blue-50 text-blue-700 border-blue-200 ring-2 ring-blue-500/20 font-bold',
      icon: 'replay',
    },
  };
  const m = map[props.recommendation];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${m.cls}`}
    >
      <AssessmentMaterialIcon name={m.icon} size={14} />
      {recommendationLabel(props.recommendation)}
    </span>
  );
}
