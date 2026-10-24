'use client';

import { formatPct, scoreBarColor } from '../../utils/format';

export function OverallScoreCell(props: { score: number | null }) {
  const pct = props.score ?? 0;
  return (
    <div className="min-w-[110px]">
      <div className="mb-1 text-sm font-semibold">{formatPct(props.score)}</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${scoreBarColor(props.score)}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
