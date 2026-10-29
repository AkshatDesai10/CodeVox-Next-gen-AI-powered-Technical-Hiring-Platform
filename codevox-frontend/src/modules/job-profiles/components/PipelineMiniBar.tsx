'use client';

type Segment = { label: string; count: number; color?: string };

export function PipelineMiniBar(props: { segments: Segment[]; total?: number }) {
  const total =
    props.total ?? (props.segments.reduce((s, seg) => s + seg.count, 0) || 1);
  if (!total) {
    return <span className="text-xs text-[var(--assessment-on-surface-variant)]">-</span>;
  }
  return (
    <div className="flex h-2 w-full min-w-[120px] overflow-hidden rounded-sm bg-[var(--assessment-surface-container)]">
      {props.segments.map((seg) => {
        const pct = Math.max(4, Math.round((seg.count / total) * 100));
        return (
          <div
            key={seg.label}
            title={`${seg.label}: ${seg.count}`}
            className="codevox-pipeline-bar-segment h-full transition-opacity hover:opacity-80"
            style={{
              width: `${pct}%`,
              backgroundColor: seg.color ?? 'var(--assessment-primary-container)',
            }}
          />
        );
      })}
    </div>
  );
}
