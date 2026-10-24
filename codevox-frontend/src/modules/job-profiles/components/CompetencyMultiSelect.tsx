'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  comboboxChevronClass,
  comboboxListClass,
  comboboxPanelClass,
  comboboxSearchInputClass,
  comboboxSearchWrapClass,
  comboboxTriggerClass,
} from '@/lib/combobox-ui';
import { cn } from '@/lib/cn';

export function CompetencyMultiSelect(props: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const {
    options,
    value,
    onChange,
    label = 'Competencies',
    placeholder = 'All competencies (no filter)',
    searchPlaceholder = 'Search competencies...',
    disabled = false,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const triggerLabel = useMemo(() => {
    if (!value.length) return placeholder;
    if (value.length === 1) return value[0];
    return `${value.length} competencies selected`;
  }, [value, placeholder]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);
  };

  const selectAll = () => onChange([...options]);
  const clearAll = () => onChange([]);

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled || !options.length}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (disabled || !options.length) return;
          setOpen((current) => !current);
        }}
        className={comboboxTriggerClass(open, disabled || !options.length)}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            value.length ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {!options.length ? 'No rubric competencies' : triggerLabel}
        </span>
        <span className={comboboxChevronClass(open)} aria-hidden>
          ▾
        </span>
      </button>

      {value.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--assessment-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--assessment-primary)]"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="rounded-full hover:bg-[var(--assessment-primary)]/20"
                onClick={() => toggle(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {open && options.length > 0 ? (
        <div className={comboboxPanelClass}>
          <div className={comboboxSearchWrapClass}>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                ⌕
              </span>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className={comboboxSearchInputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                }}
              />
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-[11px] font-semibold text-[var(--assessment-primary)] hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] font-semibold text-[var(--assessment-on-surface-variant)] hover:underline"
              >
                Clear (show all bank)
              </button>
            </div>
          </div>
          <ul id={listId} role="listbox" aria-multiselectable className={comboboxListClass}>
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">No matches</li>
            ) : (
              filteredOptions.map((name) => {
                const checked = value.includes(name);
                return (
                  <li key={name} role="option" aria-selected={checked}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(name)}
                        className="rounded border-slate-300 text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)]"
                      />
                      <span className={cn('truncate', checked && 'font-semibold text-[var(--assessment-primary)]')}>
                        {name}
                      </span>
                    </label>
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
