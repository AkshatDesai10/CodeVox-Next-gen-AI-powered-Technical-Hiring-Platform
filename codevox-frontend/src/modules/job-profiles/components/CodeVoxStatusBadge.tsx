'use client';

const STYLES: Record<string, string> = {
  draft: 'bg-[var(--assessment-outline-variant)]/20 text-[var(--codevox-outline)]',
  pending_approval: 'bg-[var(--codevox-secondary)]/10 text-[var(--codevox-secondary)]',
  active: 'bg-[var(--assessment-primary)]/10 text-[var(--assessment-primary)]',
  paused: 'bg-[var(--codevox-tertiary)]/10 text-[var(--codevox-tertiary)]',
  closed: 'bg-[var(--assessment-error,#dc2626)]/10 text-[var(--assessment-error,#dc2626)]',
  archived: 'bg-slate-200 text-slate-600',
};

export function CodeVoxStatusBadge(props: { status: string }) {
  const key = props.status.toLowerCase();
  const cls = STYLES[key] ?? STYLES.draft;
  return (
    <span className={`inline-flex rounded-full px-3 py-1 font-label-caps text-[10px] font-bold uppercase ${cls}`}>
      {props.status.replace(/_/g, ' ')}
    </span>
  );
}
