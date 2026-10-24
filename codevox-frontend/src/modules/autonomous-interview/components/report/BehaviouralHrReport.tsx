'use client';

import type { HrVoiceAudit } from '@/modules/autonomous-interview/types/interview-report';

type Props = {
  audit: HrVoiceAudit;
  /**
   * `full` — interview report page (quotes, informational answers).
   * `assessment` — assessment stage tab: flags + summary only (no recording / full conversation).
   */
  variant?: 'full' | 'assessment';
};

function statusClass(status: string | undefined) {
  if (status === 'SUPPORTED' || status === 'SATISFIED') {
    return 'text-emerald-700 bg-emerald-50';
  }
  if (status === 'CONTRADICTED' || status === 'NOT_SATISFIED') {
    return 'text-red-700 bg-red-50';
  }
  return 'text-amber-800 bg-amber-50';
}

function isFlagStatus(status: string | undefined) {
  const s = String(status ?? '').toUpperCase();
  return (
    s === 'NOT_SATISFIED' ||
    s === 'CONTRADICTED' ||
    s === 'FLAG' ||
    s === 'FAILED' ||
    s === 'UNKNOWN'
  );
}

export function BehaviouralHrReport({ audit, variant = 'full' }: Props) {
  const compact = variant === 'assessment';
  const comps = audit.competencies ?? audit.competency_evaluations ?? [];
  const eligibility = audit.eligibility ?? audit.screening_assessment?.eligibility ?? [];
  const alignments =
    audit.requirement_alignment ?? audit.requirement_alignments ?? [];
  const info =
    audit.screening_answers ?? audit.screening_assessment?.informational ?? [];

  const decisionFlags = Array.isArray(audit.decision_inputs?.flags)
    ? (audit.decision_inputs!.flags as Array<Record<string, unknown>>)
    : [];

  const eligibilityFlags = eligibility.filter((row) => isFlagStatus(row.status));
  const alignmentFlags = alignments.filter((row) => isFlagStatus(row.status));

  return (
    <section className="space-y-6 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--assessment-on-surface)]">
            {compact ? 'Behavioural Flags & Summary' : 'AI Behavioural Report'}
          </h2>
          <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
            {compact
              ? 'Soft flags and conversation summary for this round. Full transcript and recording are on the interview report.'
              : 'Eligibility, requirement alignment, and soft-competency evidence (separate from technical scorecard).'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            Outcome
          </p>
          <p className="text-lg font-semibold text-[var(--assessment-on-surface)]">
            {audit.final_outcome ?? '—'}
          </p>
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">
            {audit.platform_decision ?? '—'}
            {(() => {
              const w =
                typeof audit.weighted_competency_score === 'number'
                  ? audit.weighted_competency_score
                  : typeof (audit.weighted_competency_score as any) === 'string' &&
                      (audit.weighted_competency_score as any).trim() !== ''
                    ? Number(audit.weighted_competency_score)
                    : null;
              return w != null && Number.isFinite(w) ? ` · score ${w}/5` : '';
            })()}
          </p>
        </div>
      </div>

      {compact ? (
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
            Behavioural flags
          </h3>
          {decisionFlags.length === 0 &&
          eligibilityFlags.length === 0 &&
          alignmentFlags.length === 0 ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              No behavioural flags raised for this session.
            </p>
          ) : (
            <ul className="space-y-2">
              {decisionFlags.map((f, i) => (
                <li
                  key={`dec-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {String(f.type ?? f.flag ?? f.label ?? 'Decision flag')}
                    {f.requirement_id != null ? ` · ${String(f.requirement_id)}` : ''}
                    {f.reason != null ? ` — ${String(f.reason)}` : ''}
                  </span>
                  <span className="rounded px-2 py-0.5 text-xs font-semibold text-red-700 bg-red-100">
                    {String(f.status ?? 'FLAG')}
                  </span>
                </li>
              ))}
              {eligibilityFlags.map((row, i) => (
                <li
                  key={`el-${row.requirement_id ?? row.field ?? i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    Eligibility · {row.field ?? row.requirement_id ?? `Check ${i + 1}`}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                  >
                    {row.status ?? 'UNKNOWN'}
                  </span>
                </li>
              ))}
              {alignmentFlags.map((row) => (
                <li
                  key={`al-${row.requirement_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                >
                  <span className="font-medium">Alignment · {row.requirement_id}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                  >
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {eligibility.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Eligibility
              </h3>
              <ul className="space-y-2">
                {eligibility.map((row, i) => (
                  <li
                    key={`${row.requirement_id ?? row.field ?? i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {row.field ?? row.requirement_id ?? `Check ${i + 1}`}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                    >
                      {row.status ?? 'UNKNOWN'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {alignments.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Requirement alignment
              </h3>
              <ul className="space-y-2">
                {alignments.map((row) => (
                  <li
                    key={row.requirement_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{row.requirement_id}</span>
                      {row.importance ? (
                        <span className="ml-2 text-xs text-[var(--assessment-on-surface-variant)]">
                          {row.importance}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--assessment-on-surface-variant)]">
                NOT_ESTABLISHED means not evidenced in conversation — it is not an automatic fail.
              </p>
            </div>
          ) : null}
        </>
      )}

      {comps.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
            {compact ? 'Conversation summary' : 'Competencies'}
          </h3>
          <div className="space-y-3">
            {comps.map((c) => (
              <div
                key={c.competency_id}
                className="rounded-lg border border-[var(--assessment-outline-variant)] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-[var(--assessment-on-surface)]">
                    {c.name ?? c.competency_id}
                    {c.is_core ? (
                      <span className="ml-2 text-xs font-normal text-[var(--assessment-on-surface-variant)]">
                        core
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm font-medium">
                    {c.score != null ? `${c.score}/5` : '—'}
                    {c.level ? ` · ${c.level}` : ''}
                  </p>
                </div>
                {c.reasoning ? (
                  <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
                    {c.reasoning}
                  </p>
                ) : null}
                {!compact && (c.supporting_quotes ?? []).length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-[var(--assessment-on-surface-variant)]">
                    {(c.supporting_quotes ?? []).slice(0, 3).map((q, qi) => (
                      <li key={qi} className="border-l-2 border-[var(--assessment-outline-variant)] pl-2">
                        <span className="italic">
                          “{q.quote_original || q.quote_normalized || '—'}”
                        </span>
                        {q.quote_normalized &&
                        q.quote_original &&
                        q.quote_normalized !== q.quote_original ? (
                          <span className="block opacity-80">→ {q.quote_normalized}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!compact && info.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
            Informational answers
          </h3>
          <ul className="space-y-2 text-sm">
            {info.map((row, i) => (
              <li
                key={`${row.question_id ?? i}`}
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2"
              >
                <span className="font-medium">{row.field ?? row.category ?? 'Answer'}: </span>
                {row.answer ?? String(row.parsed_value ?? '—')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
