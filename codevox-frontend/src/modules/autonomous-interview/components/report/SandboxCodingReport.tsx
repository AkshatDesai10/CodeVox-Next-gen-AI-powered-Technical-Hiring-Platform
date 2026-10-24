'use client';

import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Code2, FlaskConical, Timer } from 'lucide-react';
import type {
  InterviewReportEnrichment,
  SandboxReport,
} from '@/modules/autonomous-interview/types/interview-report';
import { formatFinalizedAt } from '@/modules/autonomous-interview/utils/interview-report';

type Props = {
  techStack: string;
  enrichment: InterviewReportEnrichment | null;
};

function flawLabel(flaw: string): string {
  return flaw.replace(/_/g, ' ');
}

export function SandboxCodingReport({ techStack, enrichment }: Props) {
  const sandbox: SandboxReport | null = enrichment?.sandbox ?? null;
  const code =
    sandbox?.sourceCode?.trim() ?? enrichment?.submittedCode?.trim() ?? '';
  const codeQuality =
    sandbox?.codeQualityScore ?? enrichment?.codeQualityScore ?? null;
  const flaws =
    sandbox?.architecturalFlaws ??
    enrichment?.architecturalFlaws?.filter(Boolean) ??
    [];
  const hasTests = (sandbox?.totalTestCases ?? 0) > 0;
  const passed = sandbox?.passedTestCases ?? 0;
  const total = sandbox?.totalTestCases ?? 0;
  const testsPct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const language = sandbox?.language ?? techStack;

  if (!code && codeQuality == null && flaws.length === 0 && !sandbox?.hasSubmission) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[var(--assessment-on-surface)]">
          Coding Sandbox Report
        </h2>
        <div className="rounded-xl border border-dashed border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-6 text-sm text-[var(--assessment-on-surface-variant)]">
          No coding sandbox submission was captured for this interview session.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-[var(--assessment-on-surface)]">
          Coding Sandbox Report
        </h2>
        {sandbox?.assessmentTitle ? (
          <span className="rounded bg-[var(--assessment-surface-container-high)] px-2 py-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            {sandbox.assessmentTitle}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Code Quality"
          value={codeQuality != null ? `${codeQuality} / 100` : '-'}
          icon={<Code2 className="h-5 w-5 text-[var(--assessment-primary)]" />}
          barPct={codeQuality != null ? Math.min(100, codeQuality) : 0}
          showBar={codeQuality != null}
        />
        <MetricCard
          label="Tests Passed"
          value={hasTests ? `${passed} / ${total}` : '-'}
          icon={<FlaskConical className="h-5 w-5 text-[var(--assessment-primary)]" />}
          barPct={testsPct}
          showBar={hasTests}
        />
        <MetricCard
          label="Attempt Score"
          value={
            sandbox?.attemptScore != null ? String(sandbox.attemptScore) : '-'
          }
          icon={<CheckCircle2 className="h-5 w-5 text-[var(--assessment-primary)]" />}
        />
        <MetricCard
          label="Submitted"
          value={
            sandbox?.submittedAt
              ? formatFinalizedAt(sandbox.submittedAt)
              : enrichment?.currentPhase ?? '-'
          }
          icon={<Timer className="h-5 w-5 text-[var(--assessment-primary)]" />}
          compactValue
        />
      </div>

      {flaws.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-900">
            <AlertCircle className="h-4 w-4" />
            Architectural / quality notes
          </div>
          <ul className="flex flex-wrap gap-2">
            {flaws.map((flaw) => (
              <li
                key={flaw}
                className="rounded-full border border-amber-300/60 bg-[var(--assessment-surface-container)] px-3 py-1 text-xs font-medium capitalize text-amber-950"
              >
                {flawLabel(flaw)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--assessment-on-surface-variant)]">
            <Code2 className="h-4 w-4" />
            Submitted solution
          </span>
          <span className="rounded bg-[var(--assessment-surface-container-high)] px-1.5 text-[10px] font-bold uppercase">
            {language}
          </span>
        </div>
        <div className="relative max-h-80 overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)]/20 bg-[#1e1e1e] p-4 font-mono text-xs text-white shadow-inner">
          {code ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap opacity-90 interview-report-scroll">
              {code}
            </pre>
          ) : (
            <p className="text-white/50">Source code not stored for this attempt.</p>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#1e1e1e] to-transparent" />
        </div>
      </div>

      {sandbox && sandbox.submissions.length > 1 ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--assessment-outline-variant)]">
          <table className="w-full min-w-[480px] border-collapse bg-[var(--assessment-surface-container)] text-left text-sm">
            <thead>
              <tr className="bg-[var(--assessment-surface-container-high)]">
                <th className="p-3 text-xs font-bold uppercase">Question</th>
                <th className="p-3 text-xs font-bold uppercase">Tests</th>
                <th className="p-3 text-xs font-bold uppercase">Score</th>
                <th className="p-3 text-xs font-bold uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
              {sandbox.submissions.map((row) => (
                <tr key={row.questionId}>
                  <td className="p-3 font-mono text-xs">{row.questionId}</td>
                  <td className="p-3">
                    {row.totalTestCases > 0
                      ? `${row.passedTestCases} / ${row.totalTestCases}`
                      : '-'}
                  </td>
                  <td className="p-3">{row.score ?? '-'}</td>
                  <td className="p-3 capitalize">{row.status ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  icon,
  barPct,
  showBar = false,
  compactValue = false,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  barPct?: number;
  showBar?: boolean;
  compactValue?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[var(--assessment-outline)]">
        <span>{label}</span>
        {icon}
      </div>
      <div
        className={`font-bold text-[var(--assessment-primary)] ${compactValue ? 'text-sm leading-snug' : 'text-2xl'}`}
      >
        {value}
      </div>
      {showBar ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
          <div
            className="h-full bg-[var(--assessment-primary)]"
            style={{ width: `${barPct ?? 0}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
