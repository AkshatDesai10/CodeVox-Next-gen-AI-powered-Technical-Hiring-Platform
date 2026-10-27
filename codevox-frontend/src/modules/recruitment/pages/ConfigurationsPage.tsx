'use client';

import { useId, useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  getConfigurationChangeLogs,
  getSystemConfigurations,
  saveSystemConfigurations,
  type ConfigCategory,
  type ConfigChangeLogItem,
  type SystemConfigItem,
} from '@/modules/recruitment/lib/configurations-api';
import { CONFIG_HELP_GUIDES } from '@/modules/recruitment/lib/config-help-guides';

const CATEGORY_META: Record<
  ConfigCategory,
  { title: string; subtitle: string; icon: string }
> = {
  portal_proctoring: {
    title: 'Portal & Proctoring',
    subtitle: 'Camera gates, facial verification, strike policies, and timers.',
    icon: 'shield_person',
  },
  ai_models: {
    title: 'AI Models & Reasoning',
    subtitle: 'Evaluation engines, Gemini versions, reasoning levels, and quotas.',
    icon: 'psychology',
  },
  voice_audio: {
    title: 'Voice Engine & Audio',
    subtitle: 'AI interviewer voices, speech playback speed, and audio recording.',
    icon: 'record_voice_over',
  },
  api_keys: {
    title: 'API Keys & Secrets',
    subtitle: 'Update credentials live. Clear a field to restore the previous default.',
    icon: 'vpn_key',
  },
};

const CATEGORY_ORDER: ConfigCategory[] = [
  'portal_proctoring',
  'ai_models',
  'voice_audio',
  'api_keys',
];

function ModelIcon({ model = '' }: { model: string }) {
  const m = model.toLowerCase();
  const gid = useId().replace(/:/g, '');
  if (m.includes('gemini') || m.includes('google')) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#1A73E8" />
            <stop offset="0.5" stopColor="#8E75F0" />
            <stop offset="1" stopColor="#D96570" />
          </linearGradient>
        </defs>
        <path fill={`url(#${gid})`} d="M12 1.5 13.9 8.6 21 10.5 13.9 12.4 12 19.5 10.1 12.4 3 10.5 10.1 8.6Z" />
      </svg>
    );
  }
  if (m.includes('sarvam')) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
        <path fill="#5B3DF5" d="M4 16.5c2.2-4 4.2-6 8-6s5.8 2 8 6" />
        <circle cx="12" cy="7" r="2.2" fill="#F59E0B" />
      </svg>
    );
  }
  return <span className="material-symbols-outlined text-[18px] text-[var(--assessment-on-surface-variant)]">tune</span>;
}

function StyledToggle({
  checked,
  onChange,
  onLabel = 'ON',
  offLabel = 'OFF',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/40 ${
        checked ? 'bg-[var(--assessment-primary)]' : 'bg-slate-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${
          checked ? 'translate-x-8' : 'translate-x-0'
        }`}
      />
      <span
        className={`pointer-events-none absolute text-[10px] font-bold uppercase tracking-wider select-none ${
          checked ? 'left-2 text-white' : 'right-2 text-slate-700'
        }`}
      >
        {checked ? onLabel : offLabel}
      </span>
    </button>
  );
}

function ConfigFieldControl({
  item,
  draft,
  revealed,
  onChange,
  onToggleReveal,
}: {
  item: SystemConfigItem;
  draft: string;
  revealed: boolean;
  onChange: (value: string) => void;
  onToggleReveal: () => void;
}) {
  if (
    item.type === 'boolean' ||
    (item.type === 'enum' && item.options?.length === 2 && item.options.includes('on'))
  ) {
    const isOn = draft === 'true' || draft === 'on' || draft === '1' || draft === 'yes';
    const onValue = item.options?.includes('on') ? 'on' : 'true';
    const offValue = item.options?.includes('off') ? 'off' : 'false';

    return (
      <div className="flex items-center gap-3">
        <StyledToggle
          checked={isOn}
          onChange={(next) => onChange(next ? onValue : offValue)}
          onLabel={item.options?.includes('on') ? 'ON' : 'ON'}
          offLabel={item.options?.includes('off') ? 'OFF' : 'OFF'}
        />
        <span className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
          {isOn ? 'Active & Enforced' : 'Bypassed / Inactive'}
        </span>
      </div>
    );
  }

  if (item.type === 'enum' && item.key === 'REASONING_EFFORT' && item.options) {
    return (
      <div className="inline-flex rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-1">
        {item.options.map((opt) => {
          const selected = draft === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                selected
                  ? 'bg-white text-[var(--assessment-primary)] shadow-sm font-bold'
                  : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (item.type === 'enum' && item.options?.length) {
    const known = item.options.includes(draft);
    return (
      <div className="w-full space-y-2">
        <div className="relative">
          <select
            value={known ? draft : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') return;
              onChange(e.target.value);
            }}
            className="w-full appearance-none rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 pr-9 text-sm text-[var(--assessment-on-surface)] outline-none transition focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
          >
            {item.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
            {!known && draft ? <option value="__custom__">Custom: {draft}</option> : null}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-[var(--assessment-outline)]">
            <span className="material-symbols-outlined text-[20px]">expand_more</span>
          </div>
        </div>
        {item.key === 'GEMINI_MODEL' ? (
          <input
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Or type a custom model id (e.g. gemini-2.5-flash)"
            className="w-full rounded-lg border border-dashed border-[var(--assessment-outline)] bg-[var(--assessment-surface-container-low)] px-3 py-1.5 text-xs text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:bg-white"
          />
        ) : null}
      </div>
    );
  }

  if (item.type === 'number') {
    const minVal = item.min ?? 0;
    const maxVal = item.max ?? 100;
    const currentNum = Number(draft) || minVal;

    return (
      <div className="flex w-full items-center gap-3">
        <div className="relative flex-1">
          <input
            type="range"
            min={minVal}
            max={maxVal}
            step={item.step ?? 1}
            value={currentNum}
            onChange={(e) => onChange(e.target.value)}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[var(--assessment-surface-container-highest)] accent-[var(--assessment-primary)]"
          />
          <div className="mt-1 flex justify-between text-[10px] font-semibold text-[var(--assessment-on-surface-variant)]">
            <span>{minVal}</span>
            <span>{maxVal}</span>
          </div>
        </div>
        <div className="flex items-center rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-2 py-1">
          <input
            type="number"
            min={minVal}
            max={maxVal}
            step={item.step ?? 1}
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            className="w-16 bg-transparent text-center font-mono text-sm font-bold text-[var(--assessment-on-surface)] outline-none"
          />
        </div>
      </div>
    );
  }

  if (item.secret) {
    return (
      <div className="w-full space-y-1">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type={revealed ? 'text' : 'password'}
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Paste a new key, or clear to restore default"
              autoComplete="off"
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 font-mono text-sm text-[var(--assessment-on-surface)] outline-none transition placeholder:font-sans placeholder:text-[var(--assessment-outline)] focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
            />
          </div>
          <button
            type="button"
            onClick={onToggleReveal}
            className="flex items-center justify-center rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 text-[var(--assessment-on-surface-variant)] shadow-sm hover:bg-[var(--assessment-surface-container)]"
            title={revealed ? 'Hide secret' : 'Reveal secret'}
          >
            <span className="material-symbols-outlined text-[18px]">
              {revealed ? 'visibility_off' : 'visibility'}
            </span>
          </button>
        </div>
        <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
          Leave empty to restore the previous default key.
        </p>
      </div>
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm text-[var(--assessment-on-surface)] outline-none transition focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
    />
  );
}

export function ConfigurationsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ConfigCategory>('portal_proctoring');

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['system-configurations'],
    queryFn: getSystemConfigurations,
  });

  const { data: changeLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['system-configuration-logs'],
    queryFn: getConfigurationChangeLogs,
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const item of data) next[item.key] = item.value ?? '';
    setDrafts(next);
  }, [data]);

  const dirtyKeys = useMemo(() => {
    if (!data) return [] as string[];
    return data
      .filter((item) => (drafts[item.key] ?? '') !== (item.value ?? ''))
      .map((item) => item.key);
  }, [data, drafts]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!data) return [];
      const values: Record<string, string | null> = {};
      for (const item of data) {
        if (!dirtyKeys.includes(item.key)) continue;
        const draft = (drafts[item.key] ?? '').trim();
        values[item.key] = draft === '' ? null : draft;
      }
      return saveSystemConfigurations(values);
    },
    onSuccess: (items) => {
      queryClient.setQueryData(['system-configurations'], items);
      void queryClient.invalidateQueries({ queryKey: ['system-configuration-logs'] });
      setStatusBanner({
        type: 'success',
        text: `Applied ${dirtyKeys.length} runtime setting${dirtyKeys.length === 1 ? '' : 's'}. Active immediately across all sessions.`,
      });
      setTimeout(() => setStatusBanner(null), 5000);
    },
    onError: (err: Error) => {
      setStatusBanner({
        type: 'error',
        text: err.message || 'Failed to save configurations',
      });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<ConfigCategory, SystemConfigItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of data ?? []) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }

    // Portal & Proctoring: Put all toggles/switches at the top, then thresholds & timers below
    const proctorOrder = [
      'FACE',
      'PROCTOR_ENABLE_MEDIA_STRIKES',
      'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
      'PROCTOR_ENABLE_FOCUS_STRIKES',
      'PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE',
      'PROCTOR_MAX_MEDIA_STRIKES',
      'PROCTOR_MAX_FOCUS_STRIKES',
      'PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS',
      'PROCTOR_GRACE_SECONDS',
    ];
    const portalItems = map.get('portal_proctoring') ?? [];
    portalItems.sort((a, b) => {
      const idxA = proctorOrder.indexOf(a.key);
      const idxB = proctorOrder.indexOf(b.key);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      const aIsToggle = a.type === 'boolean' || a.key === 'FACE';
      const bIsToggle = b.type === 'boolean' || b.key === 'FACE';
      if (aIsToggle && !bIsToggle) return -1;
      if (!aIsToggle && bIsToggle) return 1;
      return 0;
    });

    return map;
  }, [data]);

  const currentItems = grouped.get(activeTab) ?? [];
  const currentMeta = CATEGORY_META[activeTab];

  const handleResetDrafts = () => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const item of data) next[item.key] = item.value ?? '';
    setDrafts(next);
    setStatusBanner(null);
  };

  return (
    <RecruitmentOpsShell>
      <div className="flex flex-col gap-6 pb-12">
        {/* Page Header — standard font-headline-md layout */}
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="font-headline-md text-[var(--assessment-on-surface)]">
              Configurations
            </h1>
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">
              Manage live system parameters, models, proctoring rules, and API keys without server restarts.
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isRefetching}
              title="Refresh configurations"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--assessment-outline-variant)] bg-white text-[var(--assessment-on-surface-variant)] shadow-sm hover:bg-[var(--assessment-surface-container)] disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[18px] ${isRefetching ? 'animate-spin' : ''}`}>
                refresh
              </span>
            </button>

            {dirtyKeys.length > 0 && (
              <button
                type="button"
                onClick={handleResetDrafts}
                disabled={saveMutation.isPending}
                className="rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--assessment-on-surface-variant)] shadow-sm hover:bg-[var(--assessment-surface-container)]"
              >
                Discard
              </button>
            )}

            <button
              type="button"
              disabled={!dirtyKeys.length || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className={`material-symbols-outlined text-[16px] ${saveMutation.isPending ? 'animate-spin' : ''}`}>
                {saveMutation.isPending ? 'sync' : 'save'}
              </span>
              <span>
                {saveMutation.isPending
                  ? 'Saving…'
                  : dirtyKeys.length
                    ? `Save (${dirtyKeys.length})`
                    : 'Saved'}
              </span>
            </button>
          </div>
        </header>

        {/* Status Notification */}
        {statusBanner ? (
          <div
            className={`flex items-center justify-between rounded-xl border p-3.5 text-xs font-semibold ${
              statusBanner.type === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-red-300 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">
                {statusBanner.type === 'success' ? 'check_circle' : 'error'}
              </span>
              <span>{statusBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="opacity-60 hover:opacity-100"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        ) : null}

        {dirtyKeys.length > 0 && !statusBanner && (
          <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-700">info</span>
              <span>
                You have <strong>{dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'}</strong>.
              </span>
            </div>
            <span className="text-[11px] text-amber-800">Click &ldquo;Save&rdquo; to apply immediately.</span>
          </div>
        )}

        {/* Tab Strip — matching system styling */}
        <div className="flex flex-wrap gap-2 border-b border-[var(--assessment-outline-variant)] pb-3">
          {CATEGORY_ORDER.map((catKey) => {
            const meta = CATEGORY_META[catKey];
            const active = activeTab === catKey;
            const items = grouped.get(catKey) ?? [];
            const catDirtyCount = items.filter((i) => dirtyKeys.includes(i.key)).length;

            return (
              <button
                key={catKey}
                type="button"
                onClick={() => setActiveTab(catKey)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                    : 'bg-white text-[var(--assessment-on-surface-variant)] border border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container)]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                <span>{meta.title}</span>
                {catDirtyCount > 0 ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-white">
                    {catDirtyCount}
                  </span>
                ) : (
                  <span
                    className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {items.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main Content Section Card */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--assessment-outline-variant)] bg-white py-16 text-[var(--assessment-on-surface-variant)]">
            <span className="material-symbols-outlined animate-spin text-3xl text-[var(--assessment-primary)]">
              progress_activity
            </span>
            <p className="text-sm font-medium">Loading configurations...</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {(error as Error).message}
          </div>
        ) : (
          <section className="nexus-tonal-layer overflow-hidden rounded-2xl border border-[var(--assessment-outline-variant)] bg-white shadow-sm">
            {/* Category Subheader */}
            <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[20px] text-[var(--assessment-primary)]">
                  {currentMeta.icon}
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[var(--assessment-on-surface)]">
                    {currentMeta.title}
                  </h2>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    {currentMeta.subtitle}
                  </p>
                </div>
              </div>
            </div>

            {/* Config Items List */}
            <div className="divide-y divide-[var(--assessment-outline-variant)]">
              {currentItems.map((item) => {
                const isDirty = dirtyKeys.includes(item.key);
                const guide = CONFIG_HELP_GUIDES[item.key];

                return (
                  <div
                    key={item.key}
                    className={`grid gap-4 p-4 transition-colors sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-center sm:px-6 sm:py-4 ${
                      isDirty ? 'bg-amber-50/40' : 'hover:bg-[var(--assessment-surface-container-low)]/40'
                    }`}
                  >
                    {/* Left: Label & Crisp 2-line explanation */}
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ModelIcon model={item.key} />
                        <span className="text-sm font-bold text-[var(--assessment-on-surface)]">
                          {item.label}
                        </span>
                        {isDirty && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase">
                            Unsaved
                          </span>
                        )}
                      </div>

                      {/* 2-line clean guide */}
                      {guide ? (
                        <div className="text-xs leading-relaxed text-[var(--assessment-on-surface-variant)]">
                          <p className="font-medium text-[var(--assessment-on-surface)]">{guide.purpose}</p>
                          <p className="text-[11px] opacity-80">{guide.impact}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                          {item.description}
                        </p>
                      )}
                    </div>

                    {/* Right: Input Control */}
                    <div className="flex items-center justify-start sm:justify-end">
                      <div className="w-full sm:max-w-md">
                        <ConfigFieldControl
                          item={item}
                          draft={drafts[item.key] ?? ''}
                          revealed={Boolean(revealed[item.key])}
                          onChange={(value) =>
                            setDrafts((prev) => ({ ...prev, [item.key]: value }))
                          }
                          onToggleReveal={() =>
                            setRevealed((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <RecentChangesSection logs={changeLogs} loading={logsLoading} />
      </div>
    </RecruitmentOpsShell>
  );
}

function formatChangeTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatChangeValue(value: string | null): string {
  if (value == null || value === '') return 'Default';
  return value;
}

function RecentChangesSection(props: {
  logs: ConfigChangeLogItem[];
  loading: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--assessment-outline-variant)] bg-white shadow-sm">
      <header className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/60 px-5 py-4 sm:px-6">
        <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">Recent changes</h2>
        <p className="mt-0.5 text-xs text-[var(--assessment-on-surface-variant)]">
          Who changed which setting, and what it was before.
        </p>
      </header>

      {props.loading ? (
        <p className="px-5 py-6 text-sm text-[var(--assessment-on-surface-variant)] sm:px-6">
          Loading change history…
        </p>
      ) : !props.logs.length ? (
        <p className="px-5 py-6 text-sm text-[var(--assessment-on-surface-variant)] sm:px-6">
          No changes yet. Saved updates will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--assessment-outline-variant)]">
          {props.logs.map((log) => (
            <li key={log.id} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
                  {log.label}
                </p>
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                  <span className="font-medium text-[var(--assessment-on-surface)]">
                    {formatChangeValue(log.oldValue)}
                  </span>
                  <span className="mx-1.5 text-[var(--assessment-outline)]">→</span>
                  <span className="font-medium text-[var(--assessment-on-surface)]">
                    {formatChangeValue(log.newValue)}
                  </span>
                </p>
              </div>
              <div className="shrink-0 text-left text-[11px] text-[var(--assessment-on-surface-variant)] sm:text-right">
                <p className="font-medium text-[var(--assessment-on-surface)]">
                  {log.changedBy || 'Unknown'}
                </p>
                <p>{formatChangeTime(log.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
