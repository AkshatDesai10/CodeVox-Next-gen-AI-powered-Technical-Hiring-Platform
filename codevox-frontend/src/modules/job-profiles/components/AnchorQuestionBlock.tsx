'use client';

export function AnchorQuestionBlock(props: {
  index: number;
  prompt: string;
  adaptiveBranches?: { condition: string; followUp: string; ai?: boolean }[];
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6">
      <div className="absolute left-0 top-0 h-full w-1 bg-[var(--assessment-primary)]" />
      <div className="mb-3 flex items-start justify-between">
        <span className="rounded bg-[var(--assessment-primary)]/10 px-2 py-0.5 font-label-caps text-[10px] text-[var(--assessment-primary)]">
          ANCHOR {String(props.index).padStart(2, '0')}
        </span>
      </div>
      <p className="mb-4 text-lg font-semibold leading-tight">{props.prompt}</p>
      {props.adaptiveBranches?.length ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[var(--codevox-secondary)]">
            <span className="text-sm">⎇</span>
            <span className="font-label-caps text-[10px]">AI branching logic</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {props.adaptiveBranches.map((b) => (
              <div
                key={b.condition}
                className={`rounded-lg border p-3 ${b.ai ? 'codevox-glass-ai' : 'border-[var(--assessment-outline-variant)]/50 bg-[var(--assessment-surface-container-low)]'}`}
              >
                <div className="mb-2 flex justify-between">
                  <span className="font-mono-data text-xs text-[var(--codevox-secondary)]">{b.condition}</span>
                  {b.ai ? (
                    <span className="rounded bg-[var(--codevox-secondary)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--codevox-secondary)]">
                      GEN AI
                    </span>
                  ) : null}
                </div>
                <p className="text-xs italic text-[var(--assessment-on-surface-variant)]">{b.followUp}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
