'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type {
  InterviewReportEnrichment,
  InterviewSessionReport,
} from '@/modules/autonomous-interview/types/interview-report';
import {
  DEPTH_SCORE_MAX,
  buildExecutiveSummary,
  deriveRecommendation,
  findCandidateEnded,
  findMediaTermination,
  formatFinalizedAt,
  formatProctorEventTime,
  formatSessionIdAsName,
  interviewReportKindLabel,
  mediaTerminationDetail,
  mediaTerminationMeta,
  recommendationLabel,
  recommendationStyles,
  resolveInterviewReportKind,
} from '@/modules/autonomous-interview/utils/interview-report';

type Props = {
  report: InterviewSessionReport;
  enrichment?: InterviewReportEnrichment | null;
  candidateName?: string | null;
};

function depthStroke(score: number): string {
  if (score >= 7) return '#10b981';
  if (score >= 5) return '#f59e0b';
  return '#f43f5e';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function ReportExecutiveBanner({ report, enrichment, candidateName }: Props) {
  const recommendation = deriveRecommendation(report, enrichment);
  const summaryRecommendation = recommendation === 'DISQUALIFIED' ? deriveRecommendation(report) : recommendation;
  const name = candidateName || report.candidate_name || formatSessionIdAsName(report.session_id);
  const summary = report.executive_summary?.trim() || buildExecutiveSummary(report, summaryRecommendation, enrichment, name);
  const reportLabel = interviewReportKindLabel(resolveInterviewReportKind(report, enrichment), report.tech_stack);
  const identityVerified = Boolean(enrichment?.integrity?.identity_verified_at);
  const termination = findMediaTermination(enrichment);
  const candidateEnded = findCandidateEnded(enrichment);

  const depth = Math.max(0, Math.min(DEPTH_SCORE_MAX, report.depth_score ?? 0));
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c - (depth / DEPTH_SCORE_MAX) * c;

  return (
    <div className="space-y-4">
      {candidateEnded ? (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <AssessmentMaterialIcon name="warning" size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-amber-950">
                Interview ended early by candidate
              </h2>
              <p className="mt-1 text-sm font-medium leading-relaxed text-amber-900">
                The candidate chose to end the interview before all questions were completed.
              </p>
              {candidateEnded.created_at ? (
                <p className="mt-2 text-xs font-semibold text-amber-800">
                  Ended: {formatProctorEventTime(candidateEnded.created_at)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {termination ? (
        <div className="rounded-2xl border-2 border-red-500 bg-red-50 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-sm">
              <AssessmentMaterialIcon name="gavel" size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-red-950">
                  Interview terminated early — proctoring integrity violation
                </h2>
                <span className="rounded-full bg-red-200 px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-red-900">
                  Disqualified
                </span>
              </div>
              <p className="mt-1 text-sm font-medium leading-relaxed text-red-800">
                {mediaTerminationDetail(termination)}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs font-semibold text-red-700">
                <span>Violation logged: {formatProctorEventTime(termination.created_at)}</span>
                <span>·</span>
                <span>{mediaTerminationMeta(termination)}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <section className="assessment-card overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-[var(--assessment-primary-container)] via-[var(--assessment-surface-container-low)] to-[var(--assessment-surface-container-lowest)]" />
        <div className="-mt-8 flex flex-col gap-6 px-6 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-end">
            <div className="relative shrink-0">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--assessment-primary)] text-2xl font-bold text-white shadow-md ring-4 ring-[var(--assessment-surface-container-lowest)]">
                {initialsOf(name)}
              </div>
              {identityVerified ? (
                <span
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white"
                  title="Identity verified"
                >
                  <AssessmentMaterialIcon name="check" size={14} />
                </span>
              ) : null}
            </div>
            <div className="min-w-0 space-y-2">
              <div>
                <h1 className="truncate text-2xl font-bold text-[var(--assessment-on-surface)]">{name}</h1>
                <p className="text-sm font-medium text-[var(--assessment-primary)]">{reportLabel}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-1 font-medium text-[var(--assessment-on-surface-variant)]">
                  <AssessmentMaterialIcon name="event" size={15} />
                  {formatFinalizedAt(report.finalized_at)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-1 font-medium text-[var(--assessment-on-surface-variant)]">
                  <AssessmentMaterialIcon name="forum" size={15} />
                  {report.turns?.length ?? 0} questions
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-1 font-mono text-[var(--assessment-on-surface-variant)]"
                  title={report.session_id}
                >
                  <AssessmentMaterialIcon name="tag" size={15} />
                  {report.session_id.split('_').pop()?.slice(0, 10) || report.session_id.slice(0, 10)}
                </span>
                {identityVerified ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
                    <AssessmentMaterialIcon name="verified_user" size={15} />
                    Identity verified
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-4">
            <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 112 112" aria-hidden>
                <circle cx="56" cy="56" r={r} fill="none" stroke="var(--assessment-surface-container-high)" strokeWidth="9" />
                <circle
                  cx="56"
                  cy="56"
                  r={r}
                  fill="none"
                  stroke={depthStroke(depth)}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={c}
                  strokeDashoffset={offset}
                  className="transition-[stroke-dashoffset] duration-700"
                />
              </svg>
              <div className="absolute text-center">
                <div className="text-2xl font-bold tabular-nums text-[var(--assessment-on-surface)]">
                  {report.depth_score ?? '—'}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  / {DEPTH_SCORE_MAX} depth
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                AI recommendation
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${recommendationStyles(recommendation)}`}
              >
                <AssessmentMaterialIcon
                  name={
                    recommendation === 'DISQUALIFIED'
                      ? 'gavel'
                      : recommendation === 'NO_HIRE'
                        ? 'block'
                        : recommendation === 'BORDERLINE'
                          ? 'balance'
                          : 'star'
                  }
                  size={14}
                />
                {recommendationLabel(recommendation)}
              </span>
              {enrichment?.finalDecision ? (
                <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                  Decision: <b className="text-[var(--assessment-on-surface)]">{enrichment.finalDecision.replace(/_/g, ' ').toLowerCase()}</b>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="assessment-card flex gap-3 p-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
          <AssessmentMaterialIcon name="auto_awesome" size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
            AI executive summary
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--assessment-on-surface)]">{summary}</p>
        </div>
      </section>
    </div>
  );
}
