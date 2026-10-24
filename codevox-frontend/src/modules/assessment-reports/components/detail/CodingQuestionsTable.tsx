'use client';

import { Code2, Database } from 'lucide-react';
import { useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { CodingQuestionReport, CodingStageReport } from '../../types/assessment-report';
import { formatPct } from '../../utils/format';
import { AiEvaluationSynthesisCard, RawAiPayloadPanel } from '../AiEvaluationCard';

function isSqlQuestion(q: CodingQuestionReport): boolean {
  const lang = (q.language ?? '').toLowerCase();
  const title = (q.title ?? '').toLowerCase();
  return lang === 'sql' || title.includes('sql') || title.includes('schema') || title.includes('query') || title.includes('database');
}

function difficultyCls(d?: string | null) {
  const v = (d ?? '').toLowerCase();
  if (v === 'hard') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (v === 'easy') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

function TestBar(props: { passed: number | null; total: number | null }) {
  if (props.passed == null || props.total == null || props.total === 0) {
    return <span className="text-xs text-[var(--assessment-on-surface-variant)]">—</span>;
  }
  const pct = (props.passed / props.total) * 100;
  return (
    <div className="min-w-[100px]">
      <div className="mb-1 text-xs font-medium">
        {props.passed} / {props.total} passed
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function CodingQuestionsTable(props: { stage: CodingStageReport }) {
  const [expandedId, setExpandedId] = useState<string | null>(
    props.stage.questions[0]?.problemId ?? null,
  );
  const expanded: CodingQuestionReport | undefined = props.stage.questions.find(
    (q) => q.problemId === expandedId,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-[var(--assessment-on-surface)]">
            Questions{' '}
            <span className="font-medium text-[var(--assessment-on-surface-variant)]">
              ({props.stage.questions.length})
            </span>
          </h3>
          {props.stage.runtimeEnv ? (
            <p className="text-xs text-[var(--assessment-on-surface-variant)]">
              Language Runtime: {props.stage.runtimeEnv}
            </p>
          ) : null}
        </div>
      </div>

      <div className="assessment-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--assessment-surface-container)] text-left text-xs uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            <tr>
              <th className="px-4 py-3">Problem Title</th>
              <th className="px-4 py-3">Difficulty</th>
              <th className="px-4 py-3">Language</th>
              <th className="px-4 py-3">Test Cases</th>
              <th className="px-4 py-3">Runtime &amp; Memory</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {props.stage.questions.map((q) => {
              const active = q.problemId === expandedId;
              return (
                <tr
                  key={q.problemId}
                  className={`border-t border-[var(--assessment-outline-variant)] transition ${
                    active ? 'bg-[var(--assessment-primary-container)]' : 'hover:bg-[var(--assessment-surface-container-low)]'
                  }`}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2.5">
                      {isSqlQuestion(q) ? (
                        <span
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400"
                          title="SQL / Database Problem"
                        >
                          <Database className="h-4 w-4" />
                        </span>
                      ) : (
                        <span
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--color-primary-container)] text-[var(--color-on-primary-container)]"
                          title="Coding Problem"
                        >
                          <Code2 className="h-4 w-4" />
                        </span>
                      )}
                      <span>{q.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {q.difficulty ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${difficultyCls(q.difficulty)}`}
                      >
                        {q.difficulty}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">{q.language ?? '—'}</td>
                  <td className="px-4 py-3">
                    <TestBar passed={q.testsPassed} total={q.testsTotal} />
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--assessment-on-surface-variant)]">
                    {q.runtimeMs != null ? `${q.runtimeMs}ms` : '—'}
                    {q.memoryMb != null ? ` / ${q.memoryMb} MB` : ''}
                  </td>
                  <td className="px-4 py-3 font-semibold">{formatPct(q.scorePct)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(active ? null : q.problemId)}
                      className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-[var(--assessment-primary)] hover:underline"
                    >
                      {active ? 'Hide insights' : 'View insights'}
                      <AssessmentMaterialIcon name={active ? 'expand_less' : 'expand_more'} size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!props.stage.questions.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--assessment-on-surface-variant)]">
                  No coding submissions for this stage yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {expanded ? (
        <div className="space-y-3">
          <AiEvaluationSynthesisCard
            title={`AI Evaluation Synthesis — ${expanded.title}`}
            evaluation={expanded.aiEvaluation}
          />
          <RawAiPayloadPanel payload={expanded.rawAiPayload} />
        </div>
      ) : null}
    </div>
  );
}
