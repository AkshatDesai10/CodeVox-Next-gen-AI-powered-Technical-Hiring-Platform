'use client';

type Check = {
  status?: string;
  category?: string;
  requirementId?: string;
  topicId?: string;
  severity?: string;
  requirement?: string;
  question?: string;
  candidate_evidence?: string | null;
  reason?: string;
  confidence?: number;
};

type TopicSummary = {
  id: string;
  status?: string;
  evidenceSnippets?: string[];
};

type TranscriptTurn = {
  turnIndex: number;
  role: 'agent' | 'candidate';
  text: string;
};

type Props = {
  analyzerStatus?: string | null;
  checks?: Check[] | null;
  conversationState?: unknown;
  title?: string;
  transcript?: TranscriptTurn[] | null;
};

function statusClass(status: string) {
  const s = status.toUpperCase();
  if (s === 'PASS') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (s === 'FLAG') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s === 'INSUFFICIENT_EVIDENCE') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (s === 'NOT_APPLICABLE') return 'bg-slate-50 text-slate-500 border-slate-200';
  if (s === 'PENDING' || s === 'COMPLETED' || s === 'FAILED') {
    if (s === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'FAILED') return 'bg-amber-50 text-amber-800 border-amber-200';
    return 'bg-sky-50 text-sky-700 border-sky-200';
  }
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function parseConversationSummary(raw: unknown): {
  facts: Array<{ key: string; value: string }>;
  topics: TopicSummary[];
} {
  if (!raw || typeof raw !== 'object') return { facts: [], topics: [] };
  const state = raw as Record<string, unknown>;
  const factsRaw = (state.extractedFacts ?? state.extracted_facts) as
    | Record<string, unknown>
    | undefined;
  const facts = factsRaw
    ? Object.entries(factsRaw)
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([key, value]) => ({ key, value: String(value) }))
    : [];

  const topicsRaw = (state.topics ?? {}) as Record<string, unknown>;
  const topics: TopicSummary[] = Object.entries(topicsRaw).map(([id, td]) => {
    const row = (td && typeof td === 'object' ? td : {}) as Record<string, unknown>;
    const snippets = (row.evidenceSnippets ?? row.evidence_snippets) as unknown;
    return {
      id,
      status: String(row.status ?? ''),
      evidenceSnippets: Array.isArray(snippets)
        ? snippets.map((s) => String(s)).filter(Boolean)
        : [],
    };
  });

  return { facts, topics };
}

export function AiScreeningSummaryPanel(props: Props) {
  const status = (props.analyzerStatus || 'PENDING').toUpperCase();
  const checks = props.checks ?? [];
  const transcript = props.transcript ?? [];
  const flags = checks.filter((c) => String(c.status ?? '').toUpperCase() === 'FLAG');
  const passes = checks.filter((c) => String(c.status ?? '').toUpperCase() === 'PASS');
  const insufficient = checks.filter(
    (c) => String(c.status ?? '').toUpperCase() === 'INSUFFICIENT_EVIDENCE',
  );
  const { facts, topics } = parseConversationSummary(props.conversationState);
  const discussed = topics.filter(
    (t) =>
      t.status === 'COVERED' ||
      t.status === 'IN_PROGRESS' ||
      (t.evidenceSnippets && t.evidenceSnippets.length > 0),
  );

  return (
    <div className="space-y-4">
      <div className="assessment-card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{props.title ?? 'AI Screening'}</h2>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusClass(status)}`}
          >
            {status === 'PENDING' ? 'Analysis pending' : status}
          </span>
        </div>
        <p className="text-sm text-[var(--assessment-on-surface-variant)]">
          Requirement checks run only after the interview ends. Each configured expected answer is
          compared semantically to what the candidate said — answering a question is not an automatic
          Pass. Soft flags for HR review only (no hiring score from this stage).
        </p>

        {status === 'PENDING' && (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            Screening analysis is pending. The candidate is not blocked from later stages.
          </p>
        )}
        {status === 'FAILED' && (
          <p className="text-sm text-amber-800">
            Screening analysis failed / needs review. Retry when available — no automatic fail
            flags were created.
          </p>
        )}
      </div>

      <div className="assessment-card space-y-3 p-5">
        <h3 className="text-base font-bold">Conversation Summary</h3>
        {discussed.length === 0 && facts.length === 0 ? (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            No structured conversation summary saved for this session.
          </p>
        ) : (
          <>
            {discussed.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                  Topics discussed (coverage only — not Pass/Flag)
                </div>
                <ul className="space-y-2">
                  {discussed.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                    >
                      <div className="font-semibold text-[var(--assessment-on-surface)]">
                        {t.id.replace(/_/g, ' ')}
                        {t.status ? (
                          <span className="ml-2 text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                            {t.status}
                          </span>
                        ) : null}
                      </div>
                      {t.evidenceSnippets?.[0] ? (
                        <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                          {t.evidenceSnippets[0]}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {facts.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                  Useful candidate facts
                </div>
                <ul className="space-y-1 text-sm">
                  {facts.map((f) => (
                    <li key={f.key} className="flex gap-2">
                      <span className="font-medium text-[var(--assessment-on-surface)]">
                        {f.key.replace(/_/g, ' ')}:
                      </span>
                      <span className="text-[var(--assessment-on-surface-variant)]">{f.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="assessment-card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold">Full Conversation</h3>
          {transcript.length > 0 ? (
            <span className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
              {transcript.length} turns
            </span>
          ) : null}
        </div>
        {transcript.length ? (
          <ul className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {transcript.map((t) => (
              <li
                key={`${t.turnIndex}-${t.role}-${t.text.slice(0, 24)}`}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  t.role === 'agent'
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-emerald-100 bg-emerald-50/60'
                }`}
              >
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                  {t.role === 'agent' ? 'Interviewer' : 'Candidate'}
                </div>
                <p className="whitespace-pre-wrap leading-relaxed text-[var(--assessment-on-surface)]">
                  {t.text}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            No full conversation transcript saved for this screening session.
          </p>
        )}
      </div>

      <div className="assessment-card space-y-3 p-5">
        <h3 className="text-base font-bold">Requirement checks</h3>
        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
          PASS = answer satisfies the configured requirement · FLAG = answer does not satisfy it ·
          INSUFFICIENT EVIDENCE = not enough information to decide.
        </p>

        {status === 'COMPLETED' && checks.length > 0 ? (
          <p className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            {passes.length} pass · {flags.length} flag · {insufficient.length} insufficient
            evidence
          </p>
        ) : null}
        <h3 className="text-base font-bold">Screening Flags</h3>

        {status === 'COMPLETED' && flags.length === 0 && checks.length === 0 ? (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            No configured requirements to evaluate.
          </p>
        ) : null}

        {status === 'COMPLETED' && flags.length === 0 && checks.length > 0 ? (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            No requirement mismatches flagged
            {passes.length > 0 ? ` (${passes.length} passed)` : ''}.
          </p>
        ) : null}

        {insufficient.length > 0 && status === 'COMPLETED' ? (
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">
            {insufficient.length} requirement(s) have insufficient evidence — not treated as a
            negative hiring judgment.
          </p>
        ) : null}

        <div className="space-y-3">
          {checks.map((c, idx) => (
            <div
              key={`${c.requirementId ?? c.topicId ?? 'check'}-${idx}`}
              className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(
                    String(c.status ?? ''),
                  )}`}
                >
                  {c.status}
                </span>
                {c.severity ? (
                  <span className="text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                    Severity: {c.severity}
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
                Requirement: {c.requirement || '—'}
              </p>
              {c.question ? (
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  Configured question: {c.question}
                </p>
              ) : null}
              <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
                Candidate said:{' '}
                {c.candidate_evidence ? (
                  <span className="text-[var(--assessment-on-surface)]">
                    &ldquo;{c.candidate_evidence}&rdquo;
                  </span>
                ) : (
                  <span className="italic">none</span>
                )}
              </p>
              {c.reason ? (
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  Reason: {c.reason}
                </p>
              ) : null}
              {typeof c.confidence === 'number' ? (
                <p className="mt-1 text-[11px] text-[var(--assessment-on-surface-variant)]">
                  Confidence:{' '}
                  {c.confidence >= 0.75 ? 'HIGH' : c.confidence >= 0.45 ? 'MEDIUM' : 'LOW'} (
                  {(c.confidence * 100).toFixed(0)}%)
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
