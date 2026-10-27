'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  getSystemConfigurations,
  updateSystemConfigurations,
  type EffectiveConfigItem,
} from '@/modules/recruitment/lib/recruitment-api';

type DraftMap = Record<string, string>;
type ClearedSecrets = Record<string, boolean>;

const SECTIONS: Array<{
  id: string;
  title: string;
  description: string;
  keys: string[];
}> = [
  {
    id: 'portal',
    title: 'Portal & Proctoring',
    description: 'Candidate portal identity mode and media recovery / proctoring limits.',
    keys: ['FACE', 'PROCTOR_MAX_STRIKES', 'PROCTOR_AUTO_SUBMIT', 'PROCTOR_GRACE_SECONDS'],
  },
  {
    id: 'ai',
    title: 'AI Models & Reasoning',
    description: 'LLM provider, model, reasoning effort, and token limits.',
    keys: ['LLM_PROVIDER', 'GEMINI_MODEL', 'REASONING_EFFORT', 'MAX_TOKENS'],
  },
  {
    id: 'voice',
    title: 'Voice Engine & Audio',
    description: 'Sarvam TTS speaker, pace, and recording mode.',
    keys: ['SARVAM_TTS_SPEAKER', 'SARVAM_TTS_PACE', 'RECORDING_MODE'],
  },
  {
    id: 'secrets',
    title: 'API Keys',
    description: 'Stored overrides for provider API keys. Leave blank to keep the current masked value.',
    keys: ['GEMINI_API_KEY', 'SARVAM_API_KEY', 'OPENAI_API_KEY', 'DEEPFLAG_API_KEY'],
  },
];

function sourceLabel(source: EffectiveConfigItem['source']) {
  if (source === 'db') return 'DB override';
  if (source === 'env') return '.env';
  return 'default';
}

function sourceChipClass(source: EffectiveConfigItem['source']) {
  if (source === 'db') return 'bg-emerald-100 text-emerald-800';
  if (source === 'env') return 'bg-sky-100 text-sky-800';
  return 'bg-slate-100 text-slate-700';
}

function boolFromValue(value: string) {
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export function ConfigurationsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DraftMap>({});
  const [clearedSecrets, setClearedSecrets] = useState<ClearedSecrets>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const listQuery = useQuery({
    queryKey: ['system-configurations'],
    queryFn: () => getSystemConfigurations(),
  });

  const items = listQuery.data?.items ?? [];
  const byKey = useMemo(() => {
    const map = new Map<string, EffectiveConfigItem>();
    for (const item of items) map.set(item.key, item);
    return map;
  }, [items]);

  useEffect(() => {
    if (!items.length) return;
    const next: DraftMap = {};
    for (const item of items) {
      if (item.secret) {
        next[item.key] = '';
      } else {
        next[item.key] = item.value ?? '';
      }
    }
    setDraft(next);
    setClearedSecrets({});
    setDirtyKeys(new Set());
  }, [items]);

  const markDirty = (key: string) => {
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const setValue = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setClearedSecrets((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    markDirty(key);
  };

  const clearSecret = (key: string) => {
    setDraft((prev) => ({ ...prev, [key]: '' }));
    setClearedSecrets((prev) => ({ ...prev, [key]: true }));
    markDirty(key);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const values: Record<string, string | null> = {};
      for (const key of dirtyKeys) {
        const item = byKey.get(key);
        if (!item) continue;
        if (item.secret) {
          if (clearedSecrets[key]) {
            values[key] = null;
          } else {
            const typed = (draft[key] ?? '').trim();
            if (typed) values[key] = typed;
          }
          continue;
        }
        values[key] = draft[key] ?? '';
      }
      if (Object.keys(values).length === 0) {
        throw new Error('No changes to save');
      }
      return updateSystemConfigurations(values);
    },
    onSuccess: (data) => {
      setMessage({ type: 'ok', text: 'Configurations saved.' });
      void queryClient.setQueryData(['system-configurations'], data);
      void queryClient.invalidateQueries({ queryKey: ['system-configurations'] });
    },
    onError: (err: Error) => {
      setMessage({ type: 'err', text: err.message || 'Failed to save configurations' });
    },
  });

  return (
    <RecruitmentOpsShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-headline-md text-[var(--assessment-on-surface)]">Configurations</h1>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              Dynamic system settings with DB overrides. Empty secret fields keep the current value;
              use Clear to fall back to .env.
            </p>
          </div>
          <button
            type="button"
            disabled={saveMutation.isPending || dirtyKeys.size === 0}
            onClick={() => {
              setMessage(null);
              saveMutation.mutate();
            }}
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save All'}
          </button>
        </div>

        {message ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              message.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {message.text}
          </div>
        ) : null}

        {listQuery.isLoading ? (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">Loading configurations...</p>
        ) : listQuery.isError ? (
          <p className="text-sm text-red-600">
            {(listQuery.error as Error)?.message || 'Failed to load configurations'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {SECTIONS.map((section) => (
              <section
                key={section.id}
                className="rounded-xl border border-[var(--assessment-outline-variant)] bg-white p-4"
              >
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-[var(--assessment-on-surface)]">
                    {section.title}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                    {section.description}
                  </p>
                </div>
                <div className="flex flex-col gap-4">
                  {section.keys.map((key) => {
                    const item = byKey.get(key);
                    if (!item) {
                      return (
                        <p key={key} className="text-xs text-[var(--assessment-on-surface-variant)]">
                          Missing key: {key}
                        </p>
                      );
                    }
                    return (
                      <ConfigField
                        key={key}
                        item={item}
                        value={draft[key] ?? ''}
                        cleared={Boolean(clearedSecrets[key])}
                        onChange={(v) => setValue(key, v)}
                        onClearSecret={() => clearSecret(key)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </RecruitmentOpsShell>
  );
}

function ConfigField(props: {
  item: EffectiveConfigItem;
  value: string;
  cleared: boolean;
  onChange: (value: string) => void;
  onClearSecret: () => void;
}) {
  const { item, value, cleared, onChange, onClearSecret } = props;
  const inputClass =
    'w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30';

  let control: ReactNode = null;

  if (item.key === 'FACE') {
    control = (
      <div className="inline-flex overflow-hidden rounded-lg border border-[var(--assessment-outline-variant)]">
        {(['on', 'off'] as const).map((opt) => {
          const active = (value || 'on') === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
                active
                  ? 'bg-[var(--assessment-primary)] text-white'
                  : 'bg-white text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  } else if (item.key === 'SARVAM_TTS_PACE') {
    const num = Number(value);
    const safe = Number.isFinite(num) ? Math.min(1.3, Math.max(0.7, num)) : 0.9;
    control = (
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0.7}
          max={1.3}
          step={0.05}
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="w-full accent-[var(--assessment-primary)]"
        />
        <span className="w-12 shrink-0 font-mono text-xs text-[var(--assessment-on-surface)]">
          {safe.toFixed(2)}
        </span>
      </div>
    );
  } else if (item.type === 'boolean') {
    const on = boolFromValue(value);
    control = (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(on ? 'false' : 'true')}
        className={`relative h-7 w-12 rounded-full transition-colors ${
          on ? 'bg-[var(--assessment-primary)]' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            on ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    );
  } else if (item.type === 'enum' && item.options?.length) {
    control = (
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {item.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  } else if (item.type === 'number') {
    control = (
      <input
        type="number"
        className={inputClass}
        value={value}
        min={item.min}
        max={item.max}
        step={item.key === 'SARVAM_TTS_PACE' ? 0.05 : 1}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (item.secret) {
    control = (
      <div className="flex flex-col gap-2">
        <input
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={cleared ? '' : value}
          placeholder={
            cleared
              ? 'Will use .env on save'
              : item.is_set
                ? `Current: ${item.value || '••••'}`
                : 'Not set'
          }
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClearSecret}
            className="text-xs font-semibold text-[var(--assessment-primary)] hover:underline"
          >
            Clear to use .env
          </button>
          {cleared ? (
            <span className="text-xs text-amber-700">Cleared — save to remove DB override</span>
          ) : null}
        </div>
      </div>
    );
  } else {
    control = (
      <input
        type="text"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container-lowest)] p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-[var(--assessment-on-surface)]">{item.label}</div>
          <div className="mt-0.5 text-xs text-[var(--assessment-on-surface-variant)]">
            {item.description}
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--assessment-outline)]">{item.key}</div>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sourceChipClass(item.source)}`}
        >
          {sourceLabel(item.source)}
        </span>
      </div>
      {control}
    </div>
  );
}
