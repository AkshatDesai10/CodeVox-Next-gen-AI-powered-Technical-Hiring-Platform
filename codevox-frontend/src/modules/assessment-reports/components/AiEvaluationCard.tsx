'use client';

import { useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { NormalizedAiEvaluation } from '../types/assessment-report';

export function AiEvaluationSynthesisCard(props: {
  title?: string;
  evaluation: NormalizedAiEvaluation | null | undefined;
}) {
  const ev = props.evaluation;
  const status = ev?.status ?? 'unavailable';

  const statusBadge =
    status === 'ready'
      ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Ready' }
      : status === 'evaluating'
        ? { cls: 'bg-sky-50 text-sky-700 border-sky-200', label: 'Evaluating' }
        : status === 'pending'
          ? { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Pending' }
          : { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Unavailable' };

  return (
    <div className="assessment-card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-[var(--assessment-on-surface)]">
          {props.title ?? 'AI Evaluation Synthesis'}
        </h3>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadge.cls}`}
        >
          {statusBadge.label}
        </span>
      </div>

      {status === 'evaluating' || status === 'pending' ? (
        <p className="text-sm text-[var(--assessment-on-surface-variant)]">
          AI evaluation is still in progress. Insights will appear when grading completes.
        </p>
      ) : null}

      {ev?.summary ? (
        <p className="text-sm leading-relaxed text-[var(--assessment-on-surface)]">{ev.summary}</p>
      ) : null}

      {ev?.scoreJustification && ev.scoreJustification !== ev.summary ? (
        <div className="rounded-lg border border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)]/40 p-3 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            Score justification
          </div>
          {ev.scoreJustification}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <AssessmentMaterialIcon name="check_circle" size={18} />
            Strengths
          </div>
          {ev?.strengths?.length ? (
            <ul className="space-y-1.5 text-sm text-emerald-900">
              {ev.strengths.map((s) => (
                <li key={s} className="flex gap-2">
                  <AssessmentMaterialIcon name="check" size={16} className="mt-0.5 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-800/70">No strengths captured yet.</p>
          )}
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AssessmentMaterialIcon name="warning" size={18} />
            Areas to Improve
          </div>
          {ev?.improvements?.length ? (
            <ul className="space-y-1.5 text-sm text-amber-950">
              {ev.improvements.map((s) => (
                <li key={s} className="flex gap-2">
                  <AssessmentMaterialIcon name="priority_high" size={16} className="mt-0.5 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-900/70">No improvement notes captured yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RawAiPayloadPanel(props: { payload: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
      >
        <span>Raw AI Evaluation JSON Output &amp; Model Telemetry</span>
        <AssessmentMaterialIcon name={open ? 'expand_less' : 'expand_more'} size={20} />
      </button>
      {open ? (
        <pre className="max-h-80 overflow-auto border-t border-slate-700 px-4 py-3 font-mono text-xs text-slate-200">
          {JSON.stringify(props.payload ?? null, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
