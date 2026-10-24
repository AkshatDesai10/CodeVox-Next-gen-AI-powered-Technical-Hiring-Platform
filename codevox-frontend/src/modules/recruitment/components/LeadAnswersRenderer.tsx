'use client';

type Props = {
  answers: Record<string, string> | null | undefined;
  rawFields?: Record<string, unknown>;
};

function humanizeKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LeadAnswersRenderer({ answers, rawFields }: Props) {
  const merged: Record<string, string> = { ...(answers ?? {}) };

  if (rawFields) {
    for (const [key, value] of Object.entries(rawFields)) {
      if (merged[key] != null) continue;
      if (key.startsWith('sr_') || key.startsWith('jr_') || key.includes('php')) {
        if (typeof value === 'string' || typeof value === 'number') {
          merged[key] = String(value);
        }
      }
    }
  }

  const entries = Object.entries(merged).filter(([, v]) => v != null && String(v).trim() !== '');
  if (!entries.length) {
    return <p className="text-sm text-[var(--assessment-on-surface-variant)]">No form answers recorded.</p>;
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-lg border border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)] p-3"
        >
          <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            {humanizeKey(key)}
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
