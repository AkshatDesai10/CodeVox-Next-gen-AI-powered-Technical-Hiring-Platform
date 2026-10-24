'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  archiveQuestionBankQuestion,
  createQuestionBankQuestion,
  getQuestionBankQuestion,
  updateQuestionBankQuestion,
  type QuestionBankQuestion,
} from '@/modules/job-profiles/lib/job-profiles-api';

type Props = {
  row: QuestionBankQuestion;
  onChanged: () => void;
};

export function QuestionBankRowActions({ row, onChanged }: Props) {
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

  const publish = () => {
    if (row.biasCheckPassed === false) {
      const acknowledged = window.confirm(
        `Bias check flagged this question${row.biasCheckNotes ? `: ${row.biasCheckNotes}` : ''}. Publish anyway?`,
      );
      if (!acknowledged) return;
      return run(() =>
        updateQuestionBankQuestion(row.id, { status: 'published', bias_check_acknowledged: true }),
      );
    }
    return run(() => updateQuestionBankQuestion(row.id, { status: 'published' }));
  };

  const duplicate = () =>
    run(async () => {
      const detail = await getQuestionBankQuestion(row.id);
      await createQuestionBankQuestion({
        questionText: detail.questionText,
        questionTextPlain: detail.questionTextPlain ?? undefined,
        questionType: detail.questionType,
        difficulty: detail.difficulty,
        status: 'draft',
        competencyTags: detail.competencyTags ?? undefined,
        topicTags: detail.topicTags ?? undefined,
        expectedAnswerNotes: detail.expectedAnswerNotes ?? undefined,
        idealAnswerKeywords: detail.idealAnswerKeywords ?? undefined,
        followUpQuestion: detail.followUpQuestion ?? undefined,
        followUpTrigger: detail.followUpTrigger ?? undefined,
        redFlagSignals: detail.redFlagSignals ?? undefined,
        biasCheckPassed: detail.biasCheckPassed !== false,
        biasCheckNotes: detail.biasCheckNotes ?? undefined,
        timeGuidanceSeconds: detail.timeGuidanceSeconds ?? undefined,
      });
    });

  const archive = () => {
    if (!window.confirm('Archive this question? It will be hidden from active pickers.')) return;
    return run(() => archiveQuestionBankQuestion(row.id));
  };

  const items = [
    {
      key: 'edit',
      label: 'Edit',
      icon: 'edit',
      onClick: () => {
        setOpen(false);
        router.push(`/assessments/job-profiles/question-bank/create?edit=${row.id}`);
      },
    },
    ...(row.status !== 'published'
      ? [
          {
            key: 'publish',
            label: 'Publish',
            icon: 'publish',
            onClick: publish,
          },
        ]
      : []),
    ...(row.status === 'published'
      ? [
          {
            key: 'draft',
            label: 'Move to draft',
            icon: 'draft',
            onClick: () => run(() => updateQuestionBankQuestion(row.id, { status: 'draft' })),
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
        aria-label="Question actions"
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
