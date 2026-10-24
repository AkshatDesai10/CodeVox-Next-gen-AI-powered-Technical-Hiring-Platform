'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { regenerateOverallEvaluation } from '../../lib/assessment-report-api';
import type { OverallEvaluation, OverallHireDecision } from '../../types/assessment-report';
import { formatPct } from '../../utils/format';

function decisionLabel(decision: OverallHireDecision): string {
  if (decision === 'strong_hire') return 'Strong hire';
  if (decision === 'hire') return 'Hire';
  if (decision === 'do_not_hire') return 'Do not hire';
  return 'Under review';
}

function decisionClasses(decision: OverallHireDecision): string {
  if (decision === 'strong_hire' || decision === 'hire') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  if (decision === 'do_not_hire') {
    return 'border-rose-200 bg-rose-50 text-rose-900';
  }
  return 'border-amber-200 bg-amber-50 text-amber-950';
}

export function OverallEvaluationPanel(props: {
  applicationId: string;
  evaluation: OverallEvaluation | null | undefined;
  canGenerate: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => regenerateOverallEvaluation(props.applicationId, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment-report', props.applicationId] });
    },
  });

  if (!props.evaluation && !props.canGenerate) {
    return null;
  }

  if (!props.evaluation) {
    return (
      <div className="assessment-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">
              Overall hire evaluation
            </h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              All rounds are complete. Generate a report that weighs assessment and AI verbal evidence
              more heavily than resume and behaviour.
            </p>
          </div>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--assessment-primary)] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            <AssessmentMaterialIcon name="auto_awesome" size={16} />
            {mutation.isPending ? 'Generating…' : 'Generate overall report'}
          </button>
        </div>
        {mutation.isError ? (
          <p className="mt-3 text-sm text-rose-600">Could not generate the overall evaluation.</p>
        ) : null}
      </div>
    );
  }

  const evaluation = props.evaluation;
  const isHiddenGem = evaluation.shortlistBadge === 'hidden_gem';
  const isTopPick = evaluation.shortlistBadge === 'top_pick';

  return (
    <section className="assessment-card overflow-hidden">
      {/* Top Hire Decision & Score Banner */}
      <div className={`border-b px-5 py-4 ${decisionClasses(evaluation.decision)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">
                Overall hire evaluation
              </span>
              {evaluation.generatedBy === 'llm' ? (
                <span className="inline-flex items-center gap-1 rounded bg-[var(--assessment-surface-container)] px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                  <AssessmentMaterialIcon name="auto_awesome" size={11} />
                  AI Synthesis
                </span>
              ) : null}
            </div>
            <h2 className="mt-1 text-xl font-bold">{decisionLabel(evaluation.decision)}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed">{evaluation.summary}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
              {evaluation.shortlistScore != null ? 'Shortlist Score' : 'Weighted Score'}
            </div>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="text-2xl font-bold tabular-nums">
                {formatPct(evaluation.shortlistScore ?? evaluation.weightedScorePct)}
              </span>
              {evaluation.shortlistScore != null && evaluation.weightedScorePct != null && evaluation.shortlistScore !== evaluation.weightedScorePct ? (
                <span className="text-xs opacity-75 tabular-nums">
                  (Test: {formatPct(evaluation.weightedScorePct)})
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-60"
            >
              <AssessmentMaterialIcon name="refresh" size={14} />
              {mutation.isPending ? 'Refreshing…' : 'Regenerate'}
            </button>
          </div>
        </div>
      </div>

      {/* High-Potential / Hidden Gem Special Callout Banner */}
      {isHiddenGem ? (
        <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50/90 px-5 py-3 text-amber-950">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800">
            <AssessmentMaterialIcon name="auto_awesome" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900">
                High-Potential Candidate (Hidden Gem)
              </span>
              <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                Rescued from Score Filter
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-900/90">
              {evaluation.shortlistRationale ||
                'Candidate demonstrated outstanding conceptual depth and structured reasoning across interview transcripts, indicating higher real-world capability than the raw test score suggests.'}
            </p>
          </div>
        </div>
      ) : isTopPick ? (
        <div className="flex items-start gap-3 border-b border-emerald-200 bg-emerald-50/90 px-5 py-3 text-emerald-950">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-800">
            <AssessmentMaterialIcon name="workspace_premium" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                Consensus Top Pick
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-emerald-900/90">
              {evaluation.shortlistRationale ||
                'Consistently superior performance across both objective assessments and qualitative technical evaluations.'}
            </p>
          </div>
        </div>
      ) : null}

      {/* Why Hire & Why Not Hire Columns */}
      <div className="grid gap-0 md:grid-cols-2">
        {/* Why Hire Column */}
        <div className="border-b border-[var(--assessment-outline-variant)] p-5 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-800">
              <AssessmentMaterialIcon name="thumb_up" size={18} />
              Why hire
            </h3>
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
              Top Decisive Strengths
            </span>
          </div>

          {evaluation.whyHire.length ? (
            <ul className="mt-3.5 space-y-3.5">
              {evaluation.whyHire.map((item, index) => (
                <li
                  key={`hire-${index}`}
                  className="rounded-lg border border-emerald-100/80 bg-emerald-50/40 p-3 text-sm text-[var(--assessment-on-surface)] transition hover:border-emerald-200 hover:bg-emerald-50/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-bold text-emerald-950">
                      {item.headline || item.source}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {item.competency ? (
                        <span className="rounded bg-emerald-100/90 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          {item.competency}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-[var(--assessment-on-surface-variant)] opacity-75">
                        {item.source}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--assessment-on-surface-variant)]">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--assessment-on-surface-variant)]">
              No supporting hire evidence was recorded.
            </p>
          )}
        </div>

        {/* Why Not Hire Column */}
        <div className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-rose-800">
              <AssessmentMaterialIcon name="thumb_down" size={18} />
              Why not hire
            </h3>
            <span className="text-[11px] font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/60">
              Material Concerns & Gaps
            </span>
          </div>

          {evaluation.whyNotHire.length ? (
            <ul className="mt-3.5 space-y-3.5">
              {evaluation.whyNotHire.map((item, index) => {
                const isClean = item.headline === 'No Material Concerns';
                return (
                  <li
                    key={`not-hire-${index}`}
                    className={`rounded-lg border p-3 text-sm transition ${
                      isClean
                        ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900'
                        : 'border-rose-100/80 bg-rose-50/40 text-[var(--assessment-on-surface)] hover:border-rose-200 hover:bg-rose-50/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className={`font-bold ${isClean ? 'text-emerald-900' : 'text-rose-950'}`}>
                        {item.headline || item.source}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {item.competency ? (
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                              isClean
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100/90 text-rose-800'
                            }`}
                          >
                            {item.competency}
                          </span>
                        ) : null}
                        <span className="text-[11px] text-[var(--assessment-on-surface-variant)] opacity-75">
                          {item.source}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--assessment-on-surface-variant)]">
                      {item.detail}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--assessment-on-surface-variant)]">
              No material concerns were recorded.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
