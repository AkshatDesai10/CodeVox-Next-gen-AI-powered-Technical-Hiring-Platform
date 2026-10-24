'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Segmented control wrapper for export / download actions in page toolbars. */
export function PageToolbarExports(props: {
  children: ReactNode;
  label?: string;
  className?: string;
  align?: 'start' | 'end';
}) {
  const { children, label = 'Export', className, align = 'end' } = props;
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-1',
        align === 'end' && 'sm:ml-auto',
        className,
      )}
    >
      {label ? (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
      ) : null}
      <div
        className="inline-flex items-stretch divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200/90 bg-slate-50/90 shadow-sm ring-1 ring-slate-900/[0.04] dark:divide-slate-600 dark:border-slate-600 dark:bg-slate-800/80 dark:ring-white/5"
        role="group"
        aria-label={label || 'Export options'}
      >
        {children}
      </div>
    </div>
  );
}

/** Matches {@link ExportExcelButton} `segment` variant for sibling actions (e.g. CSV). */
export const exportToolbarSegmentClass =
  'inline-flex items-center justify-center gap-1.5 bg-[var(--assessment-surface-container)] px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30 disabled:pointer-events-none disabled:opacity-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
