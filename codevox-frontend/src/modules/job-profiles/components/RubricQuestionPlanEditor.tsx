'use client';

import { NexusToggleSwitch } from '@/modules/job-profiles/components/NexusToggleSwitch';
import {
  QUESTION_PLAN_LABELS,
  defaultRubricQuestionPlan,
  primaryQuestionTotal,
  questionPlanError,
  type QuestionPlanCategory,
  type RubricQuestionPlan,
} from '@/modules/job-profiles/lib/rubric-question-plan';

export function RubricQuestionPlanEditor(props: {
  rubricName: string;
  seniority: string | null;
  value: RubricQuestionPlan | null;
  onChange: (plan: RubricQuestionPlan | null) => void;
}) {
  const usingDefaults = props.value == null;
  const plan = props.value ?? defaultRubricQuestionPlan(props.seniority);
  const primary = primaryQuestionTotal(plan);
  const buffer = Math.max(0, plan.max_total_questions - primary);
  const error = questionPlanError(plan);

  const commit = (next: RubricQuestionPlan) => {
    props.onChange(next);
  };

  const setSlot = (key: QuestionPlanCategory, patch: Partial<RubricQuestionPlan[QuestionPlanCategory]>) => {
    const current = plan[key];
    const enabled = patch.enabled ?? current.enabled;
    const count = patch.count ?? current.count;
    commit({
      ...plan,
      [key]: enabled
        ? { enabled: true, count: Math.max(1, count || 1) }
        : { enabled: false, count: 0 },
    });
  };

  return (
    <div className="border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            Question plan
          </p>
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">
            {usingDefaults
              ? 'Seniority defaults for this rubric. Change a value to save a plan that stays with this rubric only.'
              : 'Saved for this rubric only. Other rubrics keep their own plans.'}
          </p>
        </div>
        {usingDefaults ? null : (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--assessment-primary)] hover:underline"
            onClick={() => props.onChange(null)}
          >
            Use seniority defaults
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['foundational', 'technical', 'resume', 'problem_solving'] as const).map((key) => {
          const slot = plan[key];
          return (
            <label
              key={key}
              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                slot.enabled
                  ? 'border-[var(--assessment-primary)]/40 bg-[var(--assessment-surface-container)]'
                  : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)]'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <NexusToggleSwitch
                  checked={slot.enabled}
                  aria-label={`${QUESTION_PLAN_LABELS[key]} for ${props.rubricName}`}
                  onChange={(enabled) => setSlot(key, { enabled, count: enabled ? Math.max(1, slot.count) : 0 })}
                />
                {QUESTION_PLAN_LABELS[key]}
              </span>
              <span className="flex items-center gap-1 text-xs">
                <input
                  type="number"
                  min={slot.enabled ? 1 : 0}
                  max={10}
                  step={1}
                  disabled={!slot.enabled}
                  value={slot.enabled ? slot.count : 0}
                  aria-label={`${QUESTION_PLAN_LABELS[key]} question count`}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    setSlot(key, { count: Math.max(1, Math.floor(next)) });
                  }}
                  className="w-14 rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-1 text-right font-mono-data disabled:cursor-not-allowed disabled:bg-transparent disabled:text-[var(--assessment-on-surface-variant)]"
                />
                <span>q</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          Maximum questions
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={plan.max_total_questions}
            aria-label={`Maximum questions for ${props.rubricName}`}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              commit({ ...plan, max_total_questions: Math.floor(next) });
            }}
            className="w-16 rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-1 text-right font-mono-data"
          />
        </label>
        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
          Primary questions {primary}. Follow-up buffer {error ? 0 : buffer}. The maximum includes follow-ups.
        </p>
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-[var(--assessment-error)]">{error}</p> : null}
    </div>
  );
}
