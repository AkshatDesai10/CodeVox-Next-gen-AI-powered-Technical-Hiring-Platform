import { cn } from '@/lib/cn';

export function PageLoadingSkeleton(props: { className?: string }) {
  return (
    <div className={cn('animate-pulse space-y-4 p-4', props.className)}>
      <div className="h-8 w-48 rounded-lg bg-slate-200 dark:bg-slate-700" />
      <div className="rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 h-24 rounded-lg bg-slate-100 dark:bg-slate-800" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="mb-2 h-8 rounded bg-slate-50 dark:bg-slate-800/80"
            style={{ width: `${100 - i * 8}%` }}
          />
        ))}
      </div>
    </div>
  );
}
