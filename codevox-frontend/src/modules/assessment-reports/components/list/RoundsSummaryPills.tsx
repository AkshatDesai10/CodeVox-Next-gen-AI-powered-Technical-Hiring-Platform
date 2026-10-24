'use client';

import type { RoundSummaryItem } from '../../types/assessment-report';
import { roundPillClass, roundPillText } from '../../utils/format';

export function RoundsSummaryPills(props: { rounds: RoundSummaryItem[] }) {
  if (!props.rounds.length) {
    return <span className="text-xs text-[var(--assessment-on-surface-variant)]">No stages</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.rounds.map((r) => (
        <span
          key={r.stageId}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            r.endedByCandidate
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : roundPillClass(r.status)
          }`}
        >
          {roundPillText(r)}
        </span>
      ))}
    </div>
  );
}
