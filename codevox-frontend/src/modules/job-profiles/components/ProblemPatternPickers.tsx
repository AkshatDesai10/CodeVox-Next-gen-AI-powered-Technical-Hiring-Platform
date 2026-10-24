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
import {
  ERP_PATTERN_GROUPS,
  PROBLEM_TOPIC_TAG_OPTIONS,
  patternGroupsForTopic,
  patternsForTopic,
  type ProblemPatternGroup,
} from '@/modules/job-profiles/lib/problem-bank-options';

function useComboboxDismiss(open: boolean, onClose: () => void, rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose, rootRef]);
}

function useFocusSearchOnOpen(open: boolean, searchRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, searchRef]);
}

export function ProblemTopicSearchSelect(props: {
  value: string;
  onChange: (topic: string) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const {
    value,
    onChange,
    label = 'Topic Tag',
    hideLabel = false,
    placeholder = 'Select or type a topic...',
    disabled = false,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = PROBLEM_TOPIC_TAG_OPTIONS as readonly string[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((topic) => topic.toLowerCase().includes(q));
  }, [options, search]);

  const customCandidate = search.trim();
  const showCustom =
    customCandidate.length > 0 &&
    !options.some((topic) => topic.toLowerCase() === customCandidate.toLowerCase());

  useComboboxDismiss(open, () => setOpen(false), rootRef);
  useFocusSearchOnOpen(open, searchRef);

  const displayValue = value.trim() || placeholder;

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      {hideLabel ? null : (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
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
            value.trim() ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {displayValue}
        </span>
        <span className={comboboxChevronClass(open)} aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className={comboboxPanelClass}>
          <div className={comboboxSearchWrapClass}>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search topics or type custom..."
                className={comboboxSearchInputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'Enter' && customCandidate) {
                    onChange(customCandidate);
                    setOpen(false);
                    setSearch('');
                  }
                }}
              />
            </div>
          </div>
          <ul id={listId} role="listbox" className={comboboxListClass}>
            {showCustom ? (
              <li role="option" aria-selected={value === customCandidate}>
                <button
                  type="button"
                  className={comboboxOptionClass(value === customCandidate)}
                  onClick={() => {
                    onChange(customCandidate);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <span className="block truncate">Use custom topic: {customCandidate}</span>
                </button>
              </li>
            ) : null}
            {filtered.length === 0 && !showCustom ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">No topics match - type to add custom</li>
            ) : (
              filtered.map((topic) => {
                const isSelected = topic === value;
                return (
                  <li key={topic} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      className={comboboxOptionClass(isSelected)}
                      onClick={() => {
                        onChange(topic);
                        setOpen(false);
                        setSearch('');
                      }}
                    >
                      <span className="block truncate">{topic}</span>
                      {topic === 'University ERP' ? (
                        <span className="mt-0.5 block truncate text-[10px] font-normal text-slate-400">
                          Admissions | Academics | Exams | Fees | Hostel | Placements...
                        </span>
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

function filterPatternGroups(groups: ProblemPatternGroup[], query: string): ProblemPatternGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => ({
      ...group,
      patterns: group.patterns.filter(
        (pattern) =>
          pattern.toLowerCase().includes(q) || group.label.toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.patterns.length > 0);
}

export function ProblemPatternSearchSelect(props: {
  topic: string;
  value: string;
  onChange: (pattern: string) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const {
    topic,
    value,
    onChange,
    label = 'Problem Pattern',
    hideLabel = false,
    placeholder = 'Search patterns or enter custom...',
    disabled = false,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const groups = useMemo(() => patternGroupsForTopic(topic), [topic]);
  const allPatterns = useMemo(() => patternsForTopic(topic), [topic]);
  const filteredGroups = useMemo(() => filterPatternGroups(groups, search), [groups, search]);

  const customCandidate = search.trim();
  const showCustom =
    customCandidate.length > 0 &&
    !allPatterns.some((pattern) => pattern.toLowerCase() === customCandidate.toLowerCase());

  useComboboxDismiss(open, () => setOpen(false), rootRef);
  useFocusSearchOnOpen(open, searchRef);

  const displayValue = value.trim() || placeholder;
  const isCustomValue = Boolean(value.trim()) && !allPatterns.includes(value);

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      {hideLabel ? null : (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
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
            value.trim() ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400',
          )}
        >
          {displayValue}
        </span>
        {isCustomValue ? (
          <span className="mr-1 shrink-0 rounded bg-[var(--assessment-primary-container)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            Custom
          </span>
        ) : null}
        <span className={comboboxChevronClass(open)} aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className={comboboxPanelClass}>
          <div className={comboboxSearchWrapClass}>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by module or pattern name..."
                className={comboboxSearchInputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'Enter' && customCandidate) {
                    onChange(customCandidate);
                    setOpen(false);
                    setSearch('');
                  }
                }}
              />
            </div>
            {topic === 'University ERP' ? (
              <p className="mt-1.5 px-0.5 text-[10px] text-slate-400">
                {ERP_PATTERN_GROUPS.length} university modules | {allPatterns.length} patterns | type anything for custom
              </p>
            ) : null}
          </div>
          <ul id={listId} role="listbox" className={cn(comboboxListClass, 'max-h-72')}>
            {showCustom ? (
              <li role="option" aria-selected={value === customCandidate}>
                <button
                  type="button"
                  className={comboboxOptionClass(value === customCandidate)}
                  onClick={() => {
                    onChange(customCandidate);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <span className="block truncate">Use custom pattern: {customCandidate}</span>
                </button>
              </li>
            ) : null}
            {filteredGroups.length === 0 && !showCustom ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">
                No patterns match - press Enter to use your text as custom
              </li>
            ) : (
              filteredGroups.map((group) => (
                <li key={group.id}>
                  <div className="sticky top-0 z-10 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-950">
                    {group.label}
                  </div>
                  <ul>
                    {group.patterns.map((pattern) => {
                      const isSelected = pattern === value;
                      return (
                        <li key={`${group.id}-${pattern}`} role="option" aria-selected={isSelected}>
                          <button
                            type="button"
                            className={comboboxOptionClass(isSelected)}
                            onClick={() => {
                              onChange(pattern);
                              setOpen(false);
                              setSearch('');
                            }}
                          >
                            <span className="block truncate">{pattern}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
      <p className="mt-1 text-[11px] text-[var(--assessment-on-surface-variant)]">
        Search grouped patterns or enter your own scenario text.
      </p>
    </div>
  );
}
