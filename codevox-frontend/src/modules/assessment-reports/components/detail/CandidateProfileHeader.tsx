'use client';

import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applyIntegrityOverride } from '../../lib/assessment-report-api';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { AssessmentReportDetail } from '../../types/assessment-report';
import { formatDate, formatDuration, formatPct, recommendationLabel } from '../../utils/format';
import { RecommendationBadge } from '../list/ReportStatusBadge';
import { stageHasScore } from './StageNavigator';

function scoreStroke(score: number | null): string {
  if (score == null) return 'var(--assessment-outline-variant)';
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#f43f5e';
}

function CircularScore(props: { score: number | null; points?: { earned: number; total: number } | null }) {
  const pct = props.score ?? 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-surface-container-lowest)]">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128" aria-hidden>
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--assessment-surface-container-high)" strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={scoreStroke(props.score)}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold tabular-nums text-[var(--assessment-on-surface)]">
          {formatPct(props.score)}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
          {props.points ? `${props.points.earned}/${props.points.total} pts` : 'Overall'}
        </div>
      </div>
    </div>
  );
}

function ContactChip(props: { icon: string; children: ReactNode; href?: string }) {
  const cls =
    'inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-1 text-xs font-medium text-[var(--assessment-on-surface-variant)]';
  const content = (
    <>
      <AssessmentMaterialIcon name={props.icon} size={15} />
      <span className="truncate">{props.children}</span>
    </>
  );
  return props.href ? (
    <a
      href={props.href}
      target={props.href.startsWith('http') ? '_blank' : undefined}
      rel="noreferrer"
      className={`${cls} transition hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)]`}
    >
      {content}
    </a>
  ) : (
    <span className={cls}>{content}</span>
  );
}

export function CandidateProfileHeader(props: { report: AssessmentReportDetail }) {
  const { report } = props;
  const c = report.candidate;
  const disq = report.integrityDisqualification;
  const queryClient = useQueryClient();

  const { mutate: doOverride, isPending } = useMutation({
    mutationFn: (action: 'disqualify' | 'allow_retake') =>
      applyIntegrityOverride(report.application.id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment-report', report.application.id] });
      queryClient.invalidateQueries({ queryKey: ['assessment-reports'] });
    },
  });

  const handleOverride = (action: 'disqualify' | 'allow_retake') => {
    if (isPending) return;
    doOverride(action);
  };

  return (
    <div className="space-y-4">
      {disq ? (
        <div
          className={`rounded-2xl border-2 p-5 shadow-sm transition-all ${
            disq.status === 'retake'
              ? 'border-blue-300 bg-blue-50/90'
              : disq.status === 'disqualified'
                ? 'border-red-400 bg-red-50/90'
                : 'border-amber-400 bg-amber-50/90'
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${
                disq.status === 'retake'
                  ? 'bg-blue-600'
                  : disq.status === 'disqualified'
                    ? 'bg-red-600'
                    : 'bg-amber-600'
              }`}
            >
              <AssessmentMaterialIcon
                name={
                  disq.status === 'retake'
                    ? 'replay'
                    : disq.status === 'disqualified'
                      ? 'cancel'
                      : 'flag'
                }
                size={24}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  className={`text-base font-bold ${
                    disq.status === 'retake'
                      ? 'text-blue-950'
                      : disq.status === 'disqualified'
                        ? 'text-red-950'
                        : 'text-amber-950'
                  }`}
                >
                  {disq.status === 'retake'
                    ? 'Retake Allowed by Recruiter'
                    : disq.status === 'disqualified'
                      ? 'Candidate Disqualified — Proctoring Violation'
                      : 'Candidate Flagged — Proctoring Integrity Violation'}
                </h2>
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide ${
                    disq.status === 'retake'
                      ? 'bg-blue-100 text-blue-800 border border-blue-200'
                      : disq.status === 'disqualified'
                        ? 'bg-red-200 text-red-900'
                        : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  {disq.status === 'retake'
                    ? 'Retake'
                    : disq.status === 'disqualified'
                      ? 'Disqualified'
                      : 'Flagged for Review'}
                </span>
              </div>
              <p
                className={`mt-1 text-sm font-medium leading-relaxed ${
                  disq.status === 'retake'
                    ? 'text-blue-800'
                    : disq.status === 'disqualified'
                      ? 'text-red-800'
                      : 'text-amber-900'
                }`}
              >
                {disq.status === 'retake'
                  ? 'The recruiter has granted permission for this candidate to retake the interview.'
                  : disq.details ||
                    'The session was closed after excessive camera or microphone interruptions.'}
              </p>
              <div
                className={`mt-2.5 flex flex-wrap items-center gap-3 text-xs font-semibold ${
                  disq.status === 'retake'
                    ? 'text-blue-700'
                    : disq.status === 'disqualified'
                      ? 'text-red-700'
                      : 'text-amber-800'
                }`}
              >
                {disq.stageName ? <span>Round: {disq.stageName}</span> : null}
                {disq.fraudRiskScore != null ? (
                  <>
                    <span>·</span>
                    <span>Fraud risk: {disq.fraudRiskScore}/100</span>
                  </>
                ) : null}
                {disq.criticalCount != null && disq.criticalCount > 0 ? (
                  <>
                    <span>·</span>
                    <span>{disq.criticalCount} critical violation(s)</span>
                  </>
                ) : null}
                {disq.eventTime ? (
                  <>
                    <span>·</span>
                    <span>
                      Violation logged:{' '}
                      {new Date(disq.eventTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                ) : null}
              </div>

              {/* Recruiter Override Buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-2.5 pt-3 border-t border-black/10">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Recruiter Override:
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleOverride('disqualify')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition shadow-sm ${
                    disq.status === 'disqualified'
                      ? 'bg-red-700 text-white ring-2 ring-red-700/40 cursor-default'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  } disabled:opacity-50`}
                >
                  <AssessmentMaterialIcon name="cancel" size={15} />
                  {disq.status === 'disqualified' ? 'Disqualified (Active)' : 'Disqualify'}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleOverride('allow_retake')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition shadow-sm ${
                    disq.status === 'retake'
                      ? 'bg-blue-600 text-white ring-2 ring-blue-600/40 cursor-default'
                      : 'border border-blue-600 bg-[var(--assessment-surface-container)] text-blue-700 hover:bg-blue-50'
                  } disabled:opacity-50`}
                >
                  <AssessmentMaterialIcon name="replay" size={15} />
                  {disq.status === 'retake' ? 'Retake Allowed (Active)' : 'Allow Retake'}
                </button>
                {isPending ? (
                  <span className="text-xs font-medium text-slate-500 animate-pulse">
                    Saving decision...
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="assessment-card overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-[var(--assessment-primary-container)] via-[var(--assessment-surface-container-low)] to-[var(--assessment-surface-container-lowest)]" />
        <div className="-mt-10 flex flex-col gap-6 px-6 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[var(--assessment-primary)] text-2xl font-bold text-white shadow-md ring-4 ring-[var(--assessment-surface-container-lowest)]">
              {c.initials}
            </div>
            <div className="min-w-0 space-y-2">
              <div>
                <h1 className="truncate text-2xl font-bold text-[var(--assessment-on-surface)]">{c.name}</h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--assessment-on-surface-variant)]">
                  <span className="font-medium text-[var(--assessment-on-surface)]">{report.jobProfile.title}</span>
                  <span aria-hidden>·</span>
                  <span>Application #{report.application.id}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ContactChip icon="mail" href={`mailto:${c.email}`}>
                  {c.email}
                </ContactChip>
                {c.phone ? (
                  <ContactChip icon="call" href={`tel:${c.phone}`}>
                    {c.phone}
                  </ContactChip>
                ) : null}
                {c.linkedinUrl ? (
                  <ContactChip icon="link" href={c.linkedinUrl}>
                    LinkedIn
                  </ContactChip>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-4">
            <CircularScore score={report.overallScorePct} points={report.overallPoints} />
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Verdict
              </div>
              <RecommendationBadge recommendation={report.recommendation} />
              {report.application.pendingHumanReview && !disq ? (
                <div className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  <AssessmentMaterialIcon name="rate_review" size={14} />
                  Under final review
                </div>
              ) : null}
              {report.cohortRank ? (
                <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                  Top <b className="text-[var(--assessment-on-surface)]">{report.cohortRank.topPercent}%</b> of{' '}
                  {report.cohortRank.cohortSize} candidates
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {report.actionRequired ? (
          <div
            className={`mx-6 mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
              disq?.status === 'disqualified'
                ? 'border-red-200 bg-red-50 text-red-950'
                : disq?.status === 'retake'
                  ? 'border-blue-200 bg-blue-50 text-blue-950'
                  : disq?.status === 'flagged'
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-amber-200 bg-amber-50 text-amber-950'
            }`}
          >
            <AssessmentMaterialIcon
              name={
                disq?.status === 'disqualified'
                  ? 'cancel'
                  : disq?.status === 'retake'
                    ? 'replay'
                    : 'flag'
              }
              size={18}
              className={`mt-0.5 shrink-0 ${
                disq?.status === 'disqualified'
                  ? 'text-red-600'
                  : disq?.status === 'retake'
                    ? 'text-blue-600'
                    : 'text-amber-600'
              }`}
            />
            <span>
              <span className="font-semibold">Action required: </span>
              {report.actionRequired.message}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function KpiTile(props: { icon: string; label: string; value: string; hint?: string }) {
  return (
    <div className="assessment-card flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
        <AssessmentMaterialIcon name={props.icon} size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
          {props.label}
        </div>
        <div className="text-lg font-bold tabular-nums text-[var(--assessment-on-surface)]">{props.value}</div>
        {props.hint ? (
          <div className="truncate text-xs text-[var(--assessment-on-surface-variant)]">{props.hint}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ReportKpiStrip(props: { report: AssessmentReportDetail }) {
  const { report } = props;
  const stages = report.stages;
  const done = stages.filter((s) => s.status === 'completed' || s.status === 'in_review').length;
  const scored = stages.filter(stageHasScore);
  const avg = scored.length
    ? scored.reduce((sum, s) => sum + (s.scorePct ?? 0), 0) / scored.length
    : null;
  const best = scored.length
    ? scored.reduce((top, s) => ((s.scorePct ?? 0) > (top.scorePct ?? 0) ? s : top))
    : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        icon="task_alt"
        label="Rounds completed"
        value={`${done}/${stages.length}`}
        hint={stages.length - done > 0 ? `${stages.length - done} remaining` : 'All rounds done'}
      />
      <KpiTile
        icon="insights"
        label="Avg round score"
        value={formatPct(avg)}
        hint={best ? `Best: ${best.label}` : 'No scored rounds yet'}
      />
      <KpiTile
        icon="timer"
        label="Assessment time"
        value={formatDuration(report.application.totalDurationMinutes)}
      />
      <KpiTile icon="event" label="Applied on" value={formatDate(report.application.appliedAt)} />
    </div>
  );
}
