'use client';

import { formatMonthRangeDisplay, shiftMonth } from '@/lib/date-format';
import { cn } from '@/lib/cn';

export function MonthRangePicker(props: {
  value: string;
  onChange: (monthIso: string) => void;
  className?: string;
  dense?: boolean;
}) {
  const label = formatMonthRangeDisplay(props.value);
  const dense = props.dense === true;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)]',
        dense ? 'px-1 py-0.5' : 'px-1.5 py-1',
        props.className,
      )}
    >
      <button
        type="button"
        className={cn(
          'rounded text-slate-600 hover:bg-slate-50',
          dense ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm',
        )}
        aria-label="Previous month"
        onClick={() => props.onChange(shiftMonth(props.value, -1))}
      >
        ←
      </button>
      <span
        className={cn(
          'min-w-[10.5rem] text-center font-medium text-slate-800 tabular-nums',
          dense ? 'px-1 text-xs' : 'px-2 text-sm',
        )}
      >
        {label}
      </span>
      <button
        type="button"
        className={cn(
          'rounded text-slate-600 hover:bg-slate-50',
          dense ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm',
        )}
        aria-label="Next month"
        onClick={() => props.onChange(shiftMonth(props.value, 1))}
      >
        →
      </button>
    </div>
  );
}
