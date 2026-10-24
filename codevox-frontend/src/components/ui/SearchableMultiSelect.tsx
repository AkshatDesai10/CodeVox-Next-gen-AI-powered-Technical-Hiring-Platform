'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type MultiSelectOption = {
  value: string;
  label: string;
  description?: string;
};

export function SearchableMultiSelect(props: {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  maxVisibleChips?: number;
  maxSelection?: number;
  /** When set, search text is reported for server-side filtering (see `remoteSearch`). */
  onSearchQueryChange?: (query: string) => void;
  /** Skip client-side option filtering; parent supplies options from the server. */
  remoteSearch?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the label row (use `label` for aria on the trigger). */
  hideLabel?: boolean;
}) {
  const {
    label,
    options,
    value,
    onChange,
    placeholder = 'All',
    searchPlaceholder = 'Search...',
    emptyMessage = 'No matches',
    disabled = false,
    className,
    maxVisibleChips = 2,
    maxSelection,
    onSearchQueryChange,
    remoteSearch = false,
    onOpenChange,
    hideLabel = false,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const optionByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o])),
    [options],
  );

  const filtered = useMemo(() => {
    if (remoteSearch) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q),
    );
  }, [options, query, remoteSearch]);

  useEffect(() => {
    if (!onSearchQueryChange || !open) return;
    const t = window.setTimeout(() => onSearchQueryChange(query), 250);
    return () => window.clearTimeout(t);
  }, [query, open, onSearchQueryChange]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !onSearchQueryChange) return;
    onSearchQueryChange(query);
  }, [open, onSearchQueryChange, query]);

  const selectedLabels = value
    .map((v) => optionByValue.get(v)?.label)
    .filter(Boolean) as string[];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
      return;
    }
    if (maxSelection != null && value.length >= maxSelection) return;
    onChange([...value, id]);
  };

  const selectAllFiltered = () => {
    const ids = filtered.map((o) => o.value);
    onChange([...new Set([...value, ...ids])]);
  };

  const clearAll = () => onChange([]);

  const triggerSummary = () => {
    if (!value.length) {
      return (
        <span className="truncate text-slate-400 dark:text-slate-500">
          {placeholder}
        </span>
      );
    }
    const visible = selectedLabels.slice(0, maxVisibleChips);
    const rest = value.length - visible.length;
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {visible.map((name) => (
          <span
            key={name}
            className="max-w-[7rem] truncate rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand dark:bg-brand/20"
          >
            {name}
          </span>
        ))}
        {rest > 0 ? (
          <span className="shrink-0 text-[11px] font-medium text-slate-500">
            +{rest}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <div ref={rootRef} className={cn('relative min-w-[11rem]', className)}>
      {!hideLabel ? (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
          {value.length > 0 ? (
            <span className="ml-1 font-normal normal-case text-brand">
              ({value.length})
            </span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => {
            if (o) setQuery('');
            return !o;
          });
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] px-2.5 text-left shadow-sm transition',
          hideLabel ? 'py-1.5 text-xs' : 'py-2 text-sm',
          'hover:border-slate-300 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'dark:border-slate-600 dark:bg-slate-900 dark:hover:border-slate-500',
          open && 'border-brand ring-2 ring-brand/25',
        )}
      >
        <span className="min-w-0 flex-1">{triggerSummary()}</span>
        <span
          className={cn(
            'shrink-0 text-slate-400 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] shadow-lg dark:border-slate-600 dark:bg-slate-900"
          role="presentation"
        >
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <div className="relative">
              <span
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                aria-hidden
              >
                ⌕
              </span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30 dark:border-slate-600 dark:bg-slate-950"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOpen(false);
                    setQuery('');
                  }
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                className="font-medium text-brand hover:underline"
                onClick={selectAllFiltered}
                disabled={!filtered.length}
              >
                Select {query.trim() ? 'shown' : 'all'}
              </button>
              {value.length > 0 ? (
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  onClick={clearAll}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            className="max-h-56 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                {emptyMessage}
              </li>
            ) : (
              filtered.map((opt) => {
                const checked = value.includes(opt.value);
                return (
                  <li key={opt.value} role="option" aria-selected={checked}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition',
                        checked
                          ? 'bg-brand/5 text-slate-900 dark:bg-brand/10 dark:text-slate-100'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                      onClick={() => toggle(opt.value)}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold',
                          checked
                            ? 'border-brand bg-brand text-white'
                            : 'border-slate-300 bg-[var(--assessment-surface-container)] dark:border-slate-500 dark:bg-slate-900',
                        )}
                        aria-hidden
                      >
                        {checked ? '✓' : ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {opt.label}
                        </span>
                        {opt.description ? (
                          <span className="block truncate text-xs text-slate-500">
                            {opt.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
