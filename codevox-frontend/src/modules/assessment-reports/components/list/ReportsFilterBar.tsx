'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export type ReportsFilterState = {
  q: string;
  jobProfileId: string;
  stageType: string;
  status: string;
  minScore: number;
  maxScore: number;
  compact: boolean;
  datePreset: string;
  startDate: string;
  endDate: string;
  dateField: 'appliedAt' | 'updatedAt';
};

function clampScore(raw: string, fallback: number) {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function ScoreRange(props: {
  minScore: number;
  maxScore: number;
  onChange: (minScore: number, maxScore: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-1.5">
      <span className="text-xs text-[var(--assessment-on-surface-variant)]">Score</span>
      <input
        type="number"
        min={0}
        max={props.maxScore}
        inputMode="numeric"
        aria-label="Minimum score percent"
        value={props.minScore}
        onChange={(event) => {
          const next = clampScore(event.target.value, props.minScore);
          props.onChange(Math.min(next, props.maxScore), props.maxScore);
        }}
        className="w-14 rounded-md border border-[var(--assessment-outline-variant)] bg-transparent px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--assessment-primary)]"
      />
      <span className="text-xs text-[var(--assessment-on-surface-variant)]">to</span>
      <input
        type="number"
        min={props.minScore}
        max={100}
        inputMode="numeric"
        aria-label="Maximum score percent"
        value={props.maxScore}
        onChange={(event) => {
          const next = clampScore(event.target.value, props.maxScore);
          props.onChange(props.minScore, Math.max(next, props.minScore));
        }}
        className="w-14 rounded-md border border-[var(--assessment-outline-variant)] bg-transparent px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--assessment-primary)]"
      />
      <span className="text-xs text-[var(--assessment-on-surface-variant)]">%</span>
    </div>
  );
}

export function ReportsFilterBar(props: {
  value: ReportsFilterState;
  onChange: (next: ReportsFilterState) => void;
  jobProfiles: Array<{ id: string; title: string }>;
  resultCount: number;
  filteredLabel?: string | null;
  onClear: () => void;
}) {
  const { value, onChange } = props;

  return (
    <div className="assessment-card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <AssessmentMaterialIcon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-on-surface-variant)]"
          />
          <input
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            placeholder="Search name, email, or ID"
            className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] py-2 pl-10 pr-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
          />
        </div>
        <span className="rounded-full border border-[var(--assessment-outline-variant)] px-2.5 py-1 text-xs text-[var(--assessment-on-surface-variant)]">
          {props.resultCount} candidates{props.filteredLabel ? ` · ${props.filteredLabel}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value.jobProfileId}
          onChange={(e) => onChange({ ...value, jobProfileId: e.target.value })}
          className="min-w-[160px] rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm"
        >
          <option value="">All job profiles</option>
          {props.jobProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        <select
          value={value.stageType}
          onChange={(e) => onChange({ ...value, stageType: e.target.value })}
          className="min-w-[130px] rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm"
        >
          <option value="">All stages</option>
          <option value="coding">Coding</option>
          <option value="take_home">Take-home</option>
          <option value="project_interview">Build &amp; Defend</option>
          <option value="screening">Screening</option>
          <option value="ai_verbal">AI Verbal</option>
          <option value="hr_verbal">HR Verbal</option>
        </select>

        <select
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
          className="min-w-[130px] rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="passed">Passed</option>
          <option value="under_review">Completed</option>
          <option value="in_progress">In progress</option>
          <option value="failed">Failed</option>
        </select>

        {/* Date Filter Group */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-1.5">
          <AssessmentMaterialIcon
            name="calendar_today"
            size={16}
            className="text-[var(--assessment-on-surface-variant)]"
          />
          <select
            value={value.datePreset}
            onChange={(e) => {
              const next = e.target.value;
              onChange({
                ...value,
                datePreset: next,
                startDate: next === 'custom' ? value.startDate : '',
                endDate: next === 'custom' ? value.endDate : '',
              });
            }}
            className="bg-transparent text-sm text-[var(--assessment-on-surface)] outline-none cursor-pointer"
          >
            <option value="all">All time</option>
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range...</option>
          </select>

          {value.datePreset === 'custom' && (
            <div className="flex items-center gap-1.5 border-l border-[var(--assessment-outline-variant)] pl-2">
              <input
                type="date"
                value={value.startDate}
                onChange={(e) => onChange({ ...value, startDate: e.target.value })}
                className="rounded border border-[var(--assessment-outline-variant)] bg-transparent px-2 py-0.5 text-xs text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)]"
                title="Start Date"
              />
              <span className="text-xs text-[var(--assessment-on-surface-variant)]">to</span>
              <input
                type="date"
                value={value.endDate}
                onChange={(e) => onChange({ ...value, endDate: e.target.value })}
                className="rounded border border-[var(--assessment-outline-variant)] bg-transparent px-2 py-0.5 text-xs text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)]"
                title="End Date"
              />
            </div>
          )}

          <select
            value={value.dateField}
            onChange={(e) =>
              onChange({
                ...value,
                dateField: e.target.value as 'appliedAt' | 'updatedAt',
              })
            }
            className="border-l border-[var(--assessment-outline-variant)] pl-2 bg-transparent text-xs text-[var(--assessment-on-surface-variant)] outline-none cursor-pointer"
            title="Filter by Applied Date or Last Activity Date"
          >
            <option value="appliedAt">Applied</option>
            <option value="updatedAt">Updated</option>
          </select>
        </div>

        <ScoreRange
          minScore={value.minScore}
          maxScore={value.maxScore}
          onChange={(minScore, maxScore) => onChange({ ...value, minScore, maxScore })}
        />

        <label className="flex items-center gap-2 text-sm text-[var(--assessment-on-surface-variant)]">
          <input
            type="checkbox"
            checked={value.compact}
            onChange={(e) => onChange({ ...value, compact: e.target.checked })}
          />
          Compact
        </label>

        <button
          type="button"
          onClick={props.onClear}
          className="rounded-lg px-2 py-2 text-sm font-medium text-[var(--assessment-primary)] hover:underline"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
