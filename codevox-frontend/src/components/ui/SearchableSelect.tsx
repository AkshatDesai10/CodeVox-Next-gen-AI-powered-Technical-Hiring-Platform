'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  comboboxChevronClass,
  comboboxListClass,
  comboboxOptionClass,
  comboboxPanelClass,
  comboboxSearchInputClass,
  comboboxSearchWrapClass,
  comboboxTriggerClass,
} from '@/lib/combobox-ui';
import { cn } from '@/lib/cn';
import type { MultiSelectOption } from './SearchableMultiSelect';

export function SearchableSelect(props: {
  label: string;
  options: MultiSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  allowEmpty?: boolean;
  hideLabel?: boolean;
}) {
  const {
    label,
    options,
    value,
    onChange,
    placeholder = 'Select...',
    searchPlaceholder = 'Search...',
    emptyMessage = 'No matches',
    disabled = false,
    className,
    allowEmpty = true,
    hideLabel = false,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q),
    );
  }, [options, query]);

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

  return (
    <div ref={rootRef} className={cn('relative min-w-[11rem]', className)}>
      {hideLabel ? null : (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </span>
      )}
      <button
        type="button"
        disabled={disabled}
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
        className={comboboxTriggerClass(open, disabled)}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            selected ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <span className={comboboxChevronClass(open)} aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className={comboboxPanelClass}>
          <div className={comboboxSearchWrapClass}>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                ⌕
              </span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className={comboboxSearchInputClass}
                onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              />
            </div>
          </div>
          <ul id={listId} role="listbox" className={comboboxListClass}>
            {allowEmpty ? (
              <li role="option" aria-selected={!value}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  {placeholder}
                </button>
              </li>
            ) : null}
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                {emptyMessage}
              </li>
            ) : (
              filtered.map((opt) => (
                <li key={opt.value} role="option" aria-selected={value === opt.value}>
                  <button
                    type="button"
                    className={comboboxOptionClass(value === opt.value)}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <span className="block truncate">{opt.label}</span>
                    {opt.description ? (
                      <span className="block truncate text-xs text-slate-500">
                        {opt.description}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
