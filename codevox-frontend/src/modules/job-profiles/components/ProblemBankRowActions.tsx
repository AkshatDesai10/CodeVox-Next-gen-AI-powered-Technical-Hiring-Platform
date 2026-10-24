'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  archiveProblemBankProblem,
  createProblemBankProblem,
  getProblemBankProblem,
  publishProblemBankProblem,
  updateProblemBankProblem,
  upsertProblemBankTestCases,
  type ProblemBankProblem,
} from '@/modules/job-profiles/lib/job-profiles-api';
import { formatTestCaseValue } from '@/modules/job-profiles/lib/problem-bank-options';

type Props = {
  row: ProblemBankProblem;
  onChanged: () => void;
};

type ProblemDetail = Record<string, unknown>;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function mapTestCases(detail: ProblemDetail) {
  const rows = (detail.test_cases ?? detail.testCases) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => ({
    inputValue: formatTestCaseValue(item.inputValue ?? item.input_value),
    expectedOutput: formatTestCaseValue(item.expectedOutput ?? item.expected_output),
    isVisible: Number(item.isVisible ?? item.is_visible ?? 1),
    isEdgeCase: Number(item.isEdgeCase ?? item.is_edge_case ?? 0),
  }));
}

function mapLanguageTemplates(detail: ProblemDetail) {
  const rows = (detail.language_templates ?? detail.languageTemplates) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => ({
    language_code: String(item.languageCode ?? item.language_code ?? 'javascript'),
    starter_code: readString(item.starterCode ?? item.starter_code),
    internal_solution: readString(item.internalSolution ?? item.internal_solution),
  }));
}

function buildDuplicatePayload(detail: ProblemDetail, title: string) {
  const env = (detail.environmentConfig ?? detail.environment_config) as Record<string, unknown> | null;
  const evalConfig = (detail.evaluationConfig ?? detail.evaluation_config) as Record<string, unknown> | null;
  return {
    title,
    statementMd: readString(detail.statementMd ?? detail.statement_md) ?? '',
    difficulty: readString(detail.difficulty) ?? 'medium',
    marks: Number(detail.marks ?? 0),
    status: 'draft',
    topicTags: (detail.topicTags ?? detail.topic_tags) as string[] | undefined,
    allowedLanguages: (detail.allowedLanguages ?? detail.allowed_languages) as string[] | undefined,
    timeLimitMinutes: detail.timeLimitMinutes ?? detail.time_limit_minutes ?? undefined,
    workspaceType: readString(detail.workspaceType ?? detail.workspace_type),
    evaluationMode: readString(detail.evaluationMode ?? detail.evaluation_mode),
    environmentConfig: env ?? undefined,
    evaluationConfig: evalConfig ?? undefined,
    hints: (detail.hints as string[] | undefined) ?? undefined,
    language_templates: mapLanguageTemplates(detail),
    test_cases: mapTestCases(detail),
  };
}

export function ProblemBankRowActions({ row, onChanged }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const duplicate = () =>
    run(async () => {
      const detail = await getProblemBankProblem(row.id);
      const payload = buildDuplicatePayload(detail, `${row.title} (Copy)`);
      const created = await createProblemBankProblem(payload);
      const cases = mapTestCases(detail);
      if (cases.length) await upsertProblemBankTestCases(created.id, cases);
    });

  const archive = () => {
    if (!window.confirm('Archive this problem? It will be hidden from active pickers.')) return;
    return run(() => archiveProblemBankProblem(row.id));
  };

  const items = [
    {
      key: 'edit',
      label: 'Edit',
      icon: 'edit',
      onClick: () => {
        setOpen(false);
        router.push(`/assessments/job-profiles/problem-bank/create?edit=${row.id}`);
      },
    },
    ...(row.status !== 'published'
      ? [
          {
            key: 'publish',
            label: 'Publish',
            icon: 'publish',
            onClick: () => run(() => publishProblemBankProblem(row.id)),
          },
        ]
      : []),
    ...(row.status === 'published'
      ? [
          {
            key: 'draft',
            label: 'Move to draft',
            icon: 'draft',
            onClick: () => run(() => updateProblemBankProblem(row.id, { status: 'draft' })),
          },
        ]
      : []),
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: 'content_copy',
      onClick: duplicate,
    },
    ...(row.status !== 'archived'
      ? [
          {
            key: 'archive',
            label: 'Archive',
            icon: 'archive',
            onClick: archive,
          },
        ]
      : []),
  ];

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        disabled={busy}
        aria-label="Problem actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="rounded-full p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-outline-variant)]/40 disabled:opacity-50"
      >
        <span className="material-symbols-outlined">more_vert</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 min-w-[10.5rem] overflow-hidden rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={busy}
              onClick={item.onClick}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)] disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px] text-[var(--assessment-on-surface-variant)]">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
