'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { listCompetencyLibrary } from '@/modules/job-profiles/lib/job-profiles-api';

export function CompetencyLibrarySearchSelect(props: {
  value: string;
  onChange: (competencyName: string) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  department?: string;
  category?: 'hard' | 'soft';
}) {
  const {
    value,
    onChange,
    label = 'Competency',
    hideLabel = false,
    placeholder = 'Select competency...',
    searchPlaceholder = 'Search competencies...',
    emptyMessage = 'No job profile competencies found',
    disabled = false,
    className,
    department,
    category,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const libraryQuery = useQuery({
    queryKey: ['job-profile-competency-catalog', 'search-select', department ?? 'all'],
    queryFn: () => listCompetencyLibrary(department),
    staleTime: 60_000,
  });

  const allCompetencies = libraryQuery.data ?? [];
  const competencies = useMemo(() => {
    if (!category) return allCompetencies;
    return allCompetencies.filter((c) => c.category === category);
  }, [allCompetencies, category]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return competencies;
    return competencies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [competencies, search]);

  const selected = competencies.find((c) => c.name === value) ?? null;

  useEffect(() => {
    if (!competencies.length) return;
    if (competencies.some((c) => c.name === value)) return;
    onChange(competencies[0]!.name);
  }, [competencies, value, onChange]);

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

  const competencySubtitle = (c: (typeof competencies)[number]) => {
    const category = c.category === 'soft' ? 'Soft' : c.category === 'hard' ? 'Hard' : c.category;
    const target = c.default_target_score != null ? `avg target ${c.default_target_score.toFixed(1)}/5` : null;
    const weight =
      c.default_weight_pct != null ? `avg ${c.default_weight_pct.toFixed(0)}% weight` : null;
    const profiles =
      'profile_count' in c && (c as any).profile_count > 0
        ? `${(c as any).profile_count} profile${(c as any).profile_count === 1 ? '' : 's'}`
        : null;
    return [category, profiles, weight, target].filter(Boolean).join(' | ');
  };

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      {hideLabel ? null : (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      <button
        type="button"
        disabled={disabled || libraryQuery.isLoading}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (disabled || libraryQuery.isLoading) return;
          setOpen((current) => !current);
        }}
        className={comboboxTriggerClass(open, disabled || libraryQuery.isLoading)}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            selected ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {libraryQuery.isLoading ? 'Loading competencies...' : selected?.name || placeholder}
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className={comboboxSearchInputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                }}
              />
            </div>
          </div>
          <ul id={listId} role="listbox" className={comboboxListClass}>
            {libraryQuery.isLoading ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">Loading job profile competencies...</li>
            ) : libraryQuery.isError ? (
              <li className="px-3 py-6 text-center text-xs text-red-500">Failed to load competencies</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                {!competencies.length
                  ? 'No competencies on job profiles yet. Add them in job profile rubric setup (step 2).'
                  : emptyMessage}
              </li>
            ) : (
              filtered.map((c) => {
                const isSelected = c.name === value;
                return (
                  <li key={c.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={comboboxOptionClass(isSelected)}
                      onClick={() => {
                        onChange(c.name);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <span className="block truncate">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500">{competencySubtitle(c)}</span>
                      {c.description ? (
                        <span className="mt-0.5 block truncate text-[11px] text-slate-400">{c.description}</span>
                      ) : null}
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
