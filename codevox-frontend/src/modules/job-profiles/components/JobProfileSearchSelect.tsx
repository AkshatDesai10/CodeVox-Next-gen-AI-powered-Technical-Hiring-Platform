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
import {
  getJobProfile,
  listJobProfiles,
  type JobProfileSummary,
} from '@/modules/job-profiles/lib/job-profiles-api';

function profileDescription(profile: JobProfileSummary) {
  const parts = [profile.department, profile.status].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Job profile';
}

export function JobProfileSearchSelect(props: {
  value: string;
  onChange: (profileId: string) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}) {
  const {
    value,
    onChange,
    label = 'Job Profile',
    hideLabel = false,
    placeholder = 'Search job profiles...',
    searchPlaceholder = 'Search by job profile title...',
    emptyMessage = 'No job profiles found',
    disabled = false,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const localQuery = useQuery({
    queryKey: ['job-profiles-local', 'search-select', debouncedSearch],
    queryFn: () =>
      listJobProfiles({
        pageSize: 100,
        search: debouncedSearch || undefined,
      }),
    staleTime: 60_000,
  });

  const selectedProfileQuery = useQuery({
    queryKey: ['job-profile', value, 'search-select-selected'],
    queryFn: () => getJobProfile(value),
    enabled: Boolean(value),
    staleTime: 60_000,
  });

  const profiles = localQuery.data?.items ?? [];

  const selectedLabel = useMemo(() => {
    const fromList = profiles.find((profile) => profile.id === value);
    return fromList?.title ?? selectedProfileQuery.data?.profile.title ?? '';
  }, [profiles, selectedProfileQuery.data?.profile.title, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      {hideLabel ? null : (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
          setOpen((current) => !current);
        }}
        className={comboboxTriggerClass(open, disabled)}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            selectedLabel ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {selectedLabel || placeholder}
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
            {localQuery.isLoading ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">Loading job profiles...</li>
            ) : localQuery.isError ? (
              <li className="px-3 py-6 text-center text-xs text-red-500">Failed to load job profiles</li>
            ) : profiles.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">{emptyMessage}</li>
            ) : (
              profiles.map((profile) => {
                const isSelected = profile.id === value;
                return (
                  <li key={profile.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={comboboxOptionClass(isSelected)}
                      onClick={() => {
                        onChange(profile.id);
                        setOpen(false);
                      }}
                    >
                      <span className="block truncate">{profile.title}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {profileDescription(profile)}
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
