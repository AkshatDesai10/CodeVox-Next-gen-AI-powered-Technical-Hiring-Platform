import { cn } from '@/lib/cn';

/** Closed trigger (SearchableSelect, create-issue modal fields). */
export function comboboxTriggerClass(open?: boolean, disabled?: boolean) {
  return cn(
    'flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-sm shadow-sm transition',
    'hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'dark:border-slate-600 dark:bg-slate-900',
    open && 'border-brand ring-2 ring-brand/25',
    disabled && 'opacity-50',
  );
}

export const comboboxPanelClass =
  'absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-900';

export const comboboxSearchWrapClass =
  'border-b border-slate-100 p-2 dark:border-slate-800';

export const comboboxSearchInputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-brand focus:outline-none dark:border-slate-600 dark:bg-slate-950';

export const comboboxListClass = 'max-h-56 overflow-y-auto py-1';

export const comboboxOptionClass = (active: boolean) =>
  cn(
    'w-full px-3 py-2 text-left text-sm transition',
    active
      ? 'bg-brand/10 font-medium text-brand'
      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800',
  );

export const comboboxChevronClass = (open?: boolean) =>
  cn('shrink-0 text-slate-400', open && 'rotate-180');
