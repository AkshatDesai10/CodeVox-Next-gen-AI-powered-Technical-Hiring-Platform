'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type {
  InterviewSessionReport,
  ScorecardRow,
} from '@/modules/autonomous-interview/types/interview-report';
import { DEPTH_SCORE_MAX } from '@/modules/autonomous-interview/utils/interview-report';

type MatrixRow = {
  key: string;
  competency: string;
  score10: number | null;
  weightPct: number | null;
  target: number | null;
  met: boolean | null;
  samples: number | null;
  justification: string;
};

/** Prefer the backend rubric (real weights / targets); fall back to the derived 1–5 scorecard. */
export function buildMatrixRows(report: InterviewSessionReport, scorecard: ScorecardRow[]): MatrixRow[] {
  const rubric = report.rubric_scorecard;
  if (Array.isArray(rubric) && rubric.length > 0) {
    return rubric.map((row, i) => {
      const target = row.target_score ?? null;
      const met =
        row.meets_target ?? (row.score_10 != null && target != null ? row.score_10 >= target : null);
      return {
        key: row.id ?? `${row.competency}-${i}`,
        competency: row.competency,
        score10: row.score_10,
        weightPct: row.weight_pct ?? null,
        target,
        met,
        samples: row.sample_count ?? null,
        justification: row.justification,
      };
    });
  }
  return scorecard.map((row, i) => ({
    key: `${row.competency}-${i}`,
    competency: row.competency,
    score10: row.score * 2,
    weightPct: null,
    target: null,
    met: null,
    samples: null,
    justification: row.justification,
  }));
}

export function scoreTone(score10: number | null): { bar: string; text: string } {
  if (score10 == null) return { bar: 'bg-slate-300', text: 'text-[var(--assessment-on-surface-variant)]' };
  if (score10 >= 7) return { bar: 'bg-emerald-500', text: 'text-emerald-700' };
  if (score10 >= 5) return { bar: 'bg-amber-500', text: 'text-amber-700' };
  return { bar: 'bg-rose-500', text: 'text-rose-700' };
}

type Props = {
  report: InterviewSessionReport;
  rows: ScorecardRow[];
};

export function EvaluationMatrixTable({ report, rows }: Props) {
  const matrix = buildMatrixRows(report, rows);
  const withTarget = matrix.filter((r) => r.met != null);
  const metCount = withTarget.filter((r) => r.met).length;
  const showWeight = matrix.some((r) => r.weightPct != null);
  const showTarget = matrix.some((r) => r.target != null);
  const overall =
    typeof report.weighted_overall_10 === 'number'
      ? report.weighted_overall_10
      : typeof report.weighted_overall_rounded === 'number'
        ? report.weighted_overall_rounded
        : null;

  return (
    <section className="assessment-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--assessment-outline-variant)] p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
            <AssessmentMaterialIcon name="fact_check" size={20} />
          </span>
          <div>
            <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">Evaluation scorecard</h2>
            <p className="text-xs text-[var(--assessment-on-surface-variant)]">
              Per-competency scores out of 10 with the evaluator&apos;s justification
            </p>
          </div>
        </div>
        <div className="flex gap-6 text-right">
          {withTarget.length ? (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Targets met
              </div>
              <div className="text-lg font-bold tabular-nums text-[var(--assessment-on-surface)]">
                {metCount}/{withTarget.length}
              </div>
            </div>
          ) : null}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
              {overall != null ? 'Weighted overall' : 'Depth score'}
            </div>
            <div className="text-lg font-bold tabular-nums text-[var(--assessment-on-surface)]">
              {overall ?? report.depth_score ?? '—'}
              <span className="text-sm font-medium text-[var(--assessment-on-surface-variant)]"> / {DEPTH_SCORE_MAX}</span>
            </div>
          </div>
        </div>
      </div>

      {matrix.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--assessment-surface-container-low)] text-[11px] uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
              <tr>
                <th className="px-5 py-3 font-semibold">Competency</th>
                <th className="min-w-[170px] px-4 py-3 font-semibold">Score</th>
                {showWeight ? <th className="px-4 py-3 font-semibold">Weight</th> : null}
                {showTarget ? <th className="px-4 py-3 font-semibold">Target</th> : null}
                {withTarget.length ? <th className="px-4 py-3 font-semibold">Status</th> : null}
                <th className="min-w-[320px] px-5 py-3 font-semibold">Justification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
              {matrix.map((row) => {
                const tone = scoreTone(row.score10);
                return (
                  <tr key={row.key} className="align-top transition hover:bg-[var(--assessment-surface-container-low)]">
                    <td className="px-5 py-3.5 font-semibold text-[var(--assessment-on-surface)]">
                      {row.competency}
                      {row.samples != null ? (
                        <div className="text-[11px] font-normal text-[var(--assessment-on-surface-variant)]">
                          {row.samples} question{row.samples === 1 ? '' : 's'}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-8 font-mono font-semibold ${tone.text}`}>
                          {row.score10 != null ? row.score10.toFixed(1) : '—'}
                        </span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                          <span
                            className={`block h-full rounded-full ${tone.bar}`}
                            style={{ width: `${Math.min(100, Math.max(0, ((row.score10 ?? 0) / 10) * 100))}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    {showWeight ? (
                      <td className="px-4 py-3.5 font-mono text-[var(--assessment-on-surface-variant)]">
                        {row.weightPct != null ? `${row.weightPct}%` : '—'}
                      </td>
                    ) : null}
                    {showTarget ? (
                      <td className="px-4 py-3.5 font-mono text-[var(--assessment-on-surface-variant)]">
                        {row.target != null ? row.target.toFixed(1) : '—'}
                      </td>
                    ) : null}
                    {withTarget.length ? (
                      <td className="px-4 py-3.5">
                        {row.met == null ? (
                          <span className="text-[var(--assessment-on-surface-variant)]">—</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              row.met
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-rose-200 bg-rose-50 text-rose-700'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${row.met ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {row.met ? 'Met' : 'Not met'}
                          </span>
                        )}
                      </td>
                    ) : null}
                    <td className="px-5 py-3.5 leading-relaxed text-[var(--assessment-on-surface)]">
                      {row.justification || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-6 text-sm text-[var(--assessment-on-surface-variant)]">No scorecard was produced for this session.</p>
      )}
    </section>
  );
}
