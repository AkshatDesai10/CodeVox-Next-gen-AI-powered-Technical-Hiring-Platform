'use client';

import type { PipelineSegment } from '@/modules/job-profiles/lib/job-profiles-api';

const COLORS = ['#3B82F6', '#4A8FF5', '#2563EB', '#16A34A'];

export function DashboardPipelineBar(props: {
  segments: PipelineSegment[];
  total?: number;
  status?: string;
}) {
  const total = props.total ?? props.segments.reduce((s, seg) => s + seg.count, 0);
  const isDraft = props.status === 'draft';
  const isClosed = props.status === 'closed';

  if (isDraft || total === 0) {
    return (
      <div className="min-w-[200px] space-y-1">
        <div className="nexus-pipeline-bar flex w-full overflow-hidden bg-[var(--assessment-surface-container)]" />
        <p className="font-mono-data text-[10px] italic text-[var(--nexus-outline)]">Awaiting launch</p>
      </div>
    );
  }

  if (isClosed && total > 0) {
    return (
      <div className="min-w-[200px] space-y-1">
        <div className="nexus-pipeline-bar flex w-full overflow-hidden">
          <div className="h-full w-full bg-[var(--nexus-tertiary)]" />
        </div>
        <p className="font-mono-data text-[10px] font-bold text-[var(--nexus-tertiary)]">Hired pipeline</p>
      </div>
    );
  }

  const labels = props.segments.slice(0, 3).map((s, i) => ({
    id: `${s.stage_id || s.label}-${i}`,
    short: s.label.slice(0, 3).toUpperCase(),
    count: s.count,
    color: COLORS[i % COLORS.length],
    pct: total ? Math.max(4, Math.round((s.count / total) * 100)) : 0,
  }));

  return (
    <div className="min-w-[200px] space-y-1">
      <div className="nexus-pipeline-bar flex w-full overflow-hidden">
        {labels.map((seg, i) => (
          <div
            key={seg.id}
            className="nexus-pipeline-bar-segment h-full"
            style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
            title={`${seg.short}: ${seg.count}`}
          />
        ))}
        {labels.length < 3 ? (
          <div className="h-full flex-1 bg-[var(--assessment-surface-container)]" />
        ) : null}
      </div>
      <div className="flex justify-between font-mono-data text-[10px] text-[var(--nexus-outline)]">
        {labels.map((seg) => (
          <span key={seg.id}>
            {seg.count} {seg.short}
          </span>
        ))}
      </div>
    </div>
  );
}
