export const QUESTION_PLAN_CATEGORIES = [
  'foundational',
  'technical',
  'problem_solving',
  'resume',
] as const;

export type QuestionPlanCategory = (typeof QUESTION_PLAN_CATEGORIES)[number];

export type QuestionPlanSlot = {
  enabled: boolean;
  count: number;
};

export type RubricQuestionPlan = {
  foundational: QuestionPlanSlot;
  technical: QuestionPlanSlot;
  problem_solving: QuestionPlanSlot;
  resume: QuestionPlanSlot;
  max_total_questions: number;
};

const MAX_CATEGORY_COUNT = 10;
const MAX_TOTAL = 20;

type SeniorityBand = 'JUNIOR' | 'MID' | 'SENIOR';

export const QUESTION_PLAN_LABELS: Record<QuestionPlanCategory, string> = {
  foundational: 'Foundational',
  technical: 'Technical',
  resume: 'Resume-based',
  problem_solving: 'Problem-solving',
};

export function seniorityBand(seniority: string | null | undefined): SeniorityBand {
  const tokens = new Set(
    (seniority ?? '')
      .toUpperCase()
      .replace(/[/-]/g, ' ')
      .split(/[^A-Z]+/)
      .filter(Boolean),
  );
  if (
    [...tokens].some((token) =>
      ['JUNIOR', 'ENTRY', 'FRESHER', 'INTERN', 'TRAINEE', 'GRADUATE', 'STAFF', 'PRINCIPAL', 'LEAD'].includes(
        token,
      ),
    )
  ) {
    return 'JUNIOR';
  }
  if ([...tokens].some((token) => ['SENIOR', 'ARCHITECT', 'DIRECTOR'].includes(token))) {
    return 'SENIOR';
  }
  return 'MID';
}

/** Defaults for a newly added rubric. Editing this later must not rewrite saved plans. */
export function defaultRubricQuestionPlan(seniority: string | null | undefined): RubricQuestionPlan {
  const band = seniorityBand(seniority);
  const counts: Record<SeniorityBand, Record<QuestionPlanCategory, number>> = {
    JUNIOR: { foundational: 1, technical: 1, problem_solving: 0, resume: 1 },
    MID: { foundational: 0, technical: 2, problem_solving: 0, resume: 1 },
    SENIOR: { foundational: 0, technical: 1, problem_solving: 1, resume: 1 },
  };
  const chosen = counts[band];
  return {
    foundational: { enabled: chosen.foundational > 0, count: chosen.foundational },
    technical: { enabled: chosen.technical > 0, count: chosen.technical },
    problem_solving: { enabled: chosen.problem_solving > 0, count: chosen.problem_solving },
    resume: { enabled: chosen.resume > 0, count: chosen.resume },
    max_total_questions: 3,
  };
}

export function primaryQuestionTotal(plan: RubricQuestionPlan): number {
  return QUESTION_PLAN_CATEGORIES.reduce((sum, key) => {
    const slot = plan[key];
    return sum + (slot.enabled ? Math.max(0, Math.floor(Number(slot.count) || 0)) : 0);
  }, 0);
}

export function questionPlanError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'Question plan must be an object.';
  const plan = raw as Record<string, unknown>;
  let primary = 0;
  let enabledCategories = 0;
  for (const key of QUESTION_PLAN_CATEGORIES) {
    const slot = plan[key];
    if (!slot || typeof slot !== 'object') return `Question plan is missing ${key}.`;
    const row = slot as { enabled?: unknown; count?: unknown };
    const enabled = Boolean(row.enabled);
    const count = Number(row.count ?? 0);
    if (!Number.isInteger(count) || count < 0 || count > MAX_CATEGORY_COUNT) {
      return `${QUESTION_PLAN_LABELS[key]} question count must be a whole number from 0 to ${MAX_CATEGORY_COUNT}.`;
    }
    if (enabled) {
      if (count < 1) return `Set at least 1 question for ${QUESTION_PLAN_LABELS[key]}, or turn that category off.`;
      enabledCategories += 1;
      primary += count;
    }
  }
  if (enabledCategories < 1) return 'Enable at least one question category.';
  const maximum = Number(plan.max_total_questions);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_TOTAL) {
    return `Maximum questions must be a whole number from 1 to ${MAX_TOTAL}.`;
  }
  if (primary > maximum) {
    return `Primary questions (${primary}) exceed the maximum (${maximum}). Raise the maximum or lower a category count.`;
  }
  return null;
}

export function isRubricQuestionPlan(raw: unknown): raw is RubricQuestionPlan {
  return questionPlanError(raw) === null;
}
