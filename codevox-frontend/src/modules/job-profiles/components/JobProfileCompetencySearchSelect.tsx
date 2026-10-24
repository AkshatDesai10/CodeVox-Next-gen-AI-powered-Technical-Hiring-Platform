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
import { getJobProfile, type JobProfileCompetency } from '@/modules/job-profiles/lib/job-profiles-api';

export function JobProfileCompetencySearchSelect(props: {
  profileId: string;
  value: string;
  onChange: (competencyName: string) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}) {
  const {
    profileId,
    value,
    onChange,
    label = 'Competency',
    hideLabel = false,
    placeholder = 'Select rubric competency...',
    searchPlaceholder = 'Search competencies...',
    emptyMessage = 'No competencies on this job profile',
    disabled = false,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const profileQuery = useQuery({
    queryKey: ['job-profile', profileId, 'competency-select'],
    queryFn: () => getJobProfile(profileId),
    enabled: Boolean(profileId),
    staleTime: 30_000,
  });

  const competencies = profileQuery.data?.competencies ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return competencies;
    return competencies.filter((c) => c.name.toLowerCase().includes(q));
  }, [competencies, search]);

  const selected = competencies.find((c) => c.name === value) ?? null;

  useEffect(() => {
    if (!profileId) return;
    if (!competencies.length) return;
    if (competencies.some((c) => c.name === value)) return;
    onChange(competencies[0]!.name);
  }, [profileId, competencies, value, onChange]);

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

  const isDisabled = disabled || !profileId;
  const competencySubtitle = (c: JobProfileCompetency) =>
    `${c.category === 'soft' ? 'Soft' : 'Hard'} | ${c.weight_pct}% weight | target ${c.target_score ?? '-'}/5`;

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      {hideLabel ? null : (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      <button
        type="button"
        disabled={isDisabled || profileQuery.isLoading}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (isDisabled) return;
          setOpen((current) => !current);
        }}
        className={comboboxTriggerClass(open, isDisabled || profileQuery.isLoading)}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            selected ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {!profileId
            ? 'Select a job profile first'
            : profileQuery.isLoading
              ? 'Loading competencies...'
              : selected?.name || placeholder}
        </span>
        <span className={comboboxChevronClass(open)} aria-hidden>
          ▾
        </span>
      </button>

      {open && profileId ? (
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
            {profileQuery.isLoading ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">Loading rubric...</li>
            ) : profileQuery.isError ? (
              <li className="px-3 py-6 text-center text-xs text-red-500">Failed to load job profile</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                {!competencies.length
                  ? 'Add competencies to this job profile rubric (step 2) first.'
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
