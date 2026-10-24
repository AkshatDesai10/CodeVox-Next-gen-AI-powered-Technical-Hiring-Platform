'use client';

const STAGE_PILLS = ['New', 'Qualified', 'Scheduled', 'Interviewed', 'Contacted'] as const;

export const DATE_RANGES = [
  { label: 'All time', days: 0 },
  { label: 'Today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Custom range...', days: -1 },
] as const;

const PAGE_SIZES = [10, 25, 50, 100] as const;

export type LeadInboxFilters = {
  search: string;
  stage: string;
  priority: string;
  dateRangeDays: number;
  startDate: string;
  endDate: string;
  pageSize: number;
};

export const DEFAULT_LEAD_INBOX_FILTERS: LeadInboxFilters = {
  search: '',
  stage: '',
  priority: '',
  dateRangeDays: 0,
  startDate: '',
  endDate: '',
  pageSize: 25,
};

type Props = {
  open: boolean;
  onClose: () => void;
  filters: LeadInboxFilters;
  totalRecords?: number;
  currentPage?: number;
  totalPages?: number;
  activeFilterCount: number;
  onChange: (patch: Partial<LeadInboxFilters>) => void;
  onClear: () => void;
};

export function LeadInboxFilterDrawer({
  open,
  onClose,
  filters,
  totalRecords,
  currentPage,
  totalPages,
  activeFilterCount,
  onChange,
  onClear,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close filters"
        onClick={onClose}
      />
      <aside
        className="lead-inbox-filter-panel relative flex h-full w-full max-w-sm flex-col border-l border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Lead filters"
      >
        <div className="flex items-start justify-between border-b border-[var(--assessment-outline-variant)] px-4 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--assessment-on-surface)]">Filters</h2>
            <p className="text-xs text-[var(--assessment-on-surface-variant)]">
              Refine your lead inbox
              {activeFilterCount > 0 ? (
                <span className="ml-1 font-semibold text-[var(--assessment-primary)]">
                  | {activeFilterCount} active
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="lead-inbox-sidebar-scroll flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          <FilterSection label="Date range">
            <select
              className="w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
              value={filters.dateRangeDays}
              onChange={(e) => {
                const days = Number(e.target.value);
                onChange({
                  dateRangeDays: days,
                  startDate: days === -1 ? filters.startDate : '',
                  endDate: days === -1 ? filters.endDate : '',
                });
              }}
            >
              {DATE_RANGES.map((r) => (
                <option key={r.label} value={r.days}>
                  {r.label}
                </option>
              ))}
            </select>

            <div className="mt-2 flex flex-wrap gap-1">
              {[
                { label: 'ALL', days: 0 },
                { label: 'TODAY', days: 1 },
                { label: '7D', days: 7 },
                { label: '30D', days: 30 },
                { label: '90D', days: 90 },
                { label: 'CUSTOM', days: -1 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() =>
                    onChange({
                      dateRangeDays: p.days,
                      startDate: p.days === -1 ? filters.startDate : '',
                      endDate: p.days === -1 ? filters.endDate : '',
                    })
                  }
                  className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${
                    filters.dateRangeDays === p.days
                      ? 'border border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/10 text-[var(--assessment-primary)]'
                      : 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {filters.dateRangeDays === -1 && (
              <div className="mt-2.5 space-y-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2.5">
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--assessment-on-surface-variant)]">
                    From date
                  </span>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => onChange({ startDate: e.target.value, dateRangeDays: -1 })}
                    className="w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-1 text-xs text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)]"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--assessment-on-surface-variant)]">
                    To date
                  </span>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => onChange({ endDate: e.target.value, dateRangeDays: -1 })}
                    className="w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-1 text-xs text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)]"
                  />
                </div>
              </div>
            )}
          </FilterSection>

          <FilterSection label="Lead stage">
            <div className="flex flex-wrap gap-1">
              <StagePill
                label="ALL"
                active={!filters.stage}
                onClick={() => onChange({ stage: '' })}
              />
              {STAGE_PILLS.map((s) => (
                <StagePill
                  key={s}
                  label={s.toUpperCase()}
                  active={filters.stage.toLowerCase() === s.toLowerCase()}
                  onClick={() =>
                    onChange({
                      stage: filters.stage.toLowerCase() === s.toLowerCase() ? '' : s,
                    })
                  }
                />
              ))}
            </div>
          </FilterSection>

          <FilterSection label="Priority">
            <div className="flex flex-wrap gap-1">
              {(['', 'Low', 'Medium', 'High'] as const).map((p) => (
                <StagePill
                  key={p || 'all'}
                  label={p ? p.toUpperCase() : 'ALL'}
                  active={filters.priority === p}
                  onClick={() => onChange({ priority: p })}
                />
              ))}
            </div>
          </FilterSection>

          <FilterSection label="Rows per page">
            <select
              className="w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-1.5 text-sm"
              value={filters.pageSize}
              onChange={(e) => onChange({ pageSize: Number(e.target.value) })}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
          </FilterSection>
        </div>

        <div className="border-t border-[var(--assessment-outline-variant)] px-4 py-4">
          {totalRecords != null ? (
            <p className="mb-3 text-center text-xs text-[var(--assessment-on-surface-variant)]">
              <span className="font-mono text-sm font-semibold text-[var(--assessment-on-surface)]">
                {totalRecords.toLocaleString()}
              </span>{' '}
              total records
              {currentPage != null && totalPages != null ? (
                <>
                  {' '}
                  | page {currentPage} of {totalPages.toLocaleString()}
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClear}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-medium text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)]"
            >
              <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
              Clear
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-sm font-semibold text-white"
            >
              Apply
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function FilterSection(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

function StagePill(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded px-2 py-1 text-[10px] font-bold transition-colors ${
        props.active
          ? 'border border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/20 text-[var(--assessment-primary)]'
          : 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)]'
      }`}
    >
      {props.label}
    </button>
  );
}

export function dateRangeToDates(
  days: number,
  customStart?: string,
  customEnd?: string,
): { date_from?: string; date_to?: string } {
  if (days === -1) {
    return {
      date_from: customStart?.trim() || undefined,
      date_to: customEnd?.trim() || undefined,
    };
  }
  if (!days || days <= 0) {
    return {};
  }
  if (days === 1) {
    const today = new Date().toISOString().slice(0, 10);
    return { date_from: today, date_to: today };
  }
  const d = new Date();
  d.setDate(d.getDate() - days);
  return { date_from: d.toISOString().slice(0, 10), date_to: undefined };
}

export function dateRangeToFrom(days: number): string | undefined {
  return dateRangeToDates(days).date_from;
}

export function countActiveFilters(filters: LeadInboxFilters): number {
  let n = 0;
  if (filters.stage) n += 1;
  if (filters.priority) n += 1;
  if (filters.dateRangeDays !== 0) n += 1;
  if (filters.search.trim()) n += 1;
  if (filters.pageSize !== DEFAULT_LEAD_INBOX_FILTERS.pageSize) n += 1;
  return n;
}
