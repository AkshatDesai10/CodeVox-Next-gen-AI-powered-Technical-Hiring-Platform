/**
 * Interview-wide AI Verbal question budget.
 * Missing keys are a legacy profile: the voice engine plans one primary per rubric
 * and does not write a budget back. Present keys are validated here.
 */

export const VERBAL_MIN_PRIMARY_KEY = 'verbal_min_primary_questions';
export const VERBAL_MAX_TOTAL_KEY = 'verbal_max_total_questions';
export const VERBAL_DURATION_KEY = 'verbal_duration_limit_minutes';

export function verbalBudgetShapeError(minimum: number, maximum: number): string | null {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) {
    return 'Minimum and maximum questions must be whole numbers.';
  }
  if (minimum < 1 || maximum < 1) {
    return 'Minimum and maximum questions must be at least 1.';
  }
  if (minimum > maximum) {
    return `Minimum primary questions (${minimum}) cannot exceed the maximum (${maximum}).`;
  }
  if (maximum > 40) {
    return 'Maximum questions cannot exceed 40.';
  }
  return null;
}

export function verbalBudgetCoverageError(minimum: number, rubricCount: number): string | null {
  if (rubricCount < 1) {
    return 'Select at least one rubric before setting the interview question budget.';
  }
  if (minimum < rubricCount) {
    return (
      `Minimum primary questions (${minimum}) is less than the number of required rubrics ` +
      `(${rubricCount}). Give every rubric at least one question, or remove a rubric.`
    );
  }
  return null;
}

export function verbalDurationError(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const minutes = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 50) {
    return 'Interview duration limit must be a whole number of minutes from 10 to 50.';
  }
  return null;
}

function wholeNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isInteger(Number(raw))) {
    return Number(raw);
  }
  return null;
}

/** Null when the stage has no saved budget. An error string when the saved budget is invalid. */
export function verbalBudgetSaveError(
  roundConfig: Record<string, unknown> | null | undefined,
  rubricCount: number,
  options?: { requireCoverage?: boolean },
): string | null {
  const config = roundConfig ?? {};
  const durationError = verbalDurationError(config[VERBAL_DURATION_KEY]);
  if (durationError) return durationError;
  const hasMin = config[VERBAL_MIN_PRIMARY_KEY] != null && config[VERBAL_MIN_PRIMARY_KEY] !== '';
  const hasMax = config[VERBAL_MAX_TOTAL_KEY] != null && config[VERBAL_MAX_TOTAL_KEY] !== '';
  if (!hasMin && !hasMax) return null;
  if (!hasMin || !hasMax) {
    return 'Set both the minimum primary questions and the maximum total questions.';
  }
  const minimum = wholeNumber(config[VERBAL_MIN_PRIMARY_KEY]);
  const maximum = wholeNumber(config[VERBAL_MAX_TOTAL_KEY]);
  if (minimum == null || maximum == null) {
    return 'Minimum and maximum questions must be whole numbers.';
  }
  const shape = verbalBudgetShapeError(minimum, maximum);
  if (shape) return shape;
  if (options?.requireCoverage === false) return null;
  return verbalBudgetCoverageError(minimum, rubricCount);
}

/** Largest-remainder split. Every rubric receives at least one seat. Mirrors the voice engine. */
export function allocatePrimaryQuestions(weights: number[], minimum: number): number[] | string {
  const count = weights.length;
  if (count < 1) return 'Select at least one rubric.';
  if (!Number.isInteger(minimum) || minimum < 1) {
    return 'Minimum primary questions must be at least 1.';
  }
  if (minimum < count) {
    return (
      `Minimum primary questions (${minimum}) is less than the number of required rubrics ` +
      `(${count}). Give every rubric at least one question, or remove a rubric.`
    );
  }
  let safe = weights.map((weight) => (weight > 0 ? weight : 0));
  let total = safe.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    safe = safe.map(() => 1);
    total = count;
  }
  const raw = safe.map((weight) => minimum * (weight / total));
  const seats = raw.map((value) => Math.floor(value + 1e-9));
  let leftover = minimum - seats.reduce((sum, seat) => sum + seat, 0);
  const ranked = seats
    .map((_, index) => index)
    .sort((left, right) => {
      const remainder = raw[right] - seats[right] - (raw[left] - seats[left]);
      if (remainder !== 0) return remainder;
      if (safe[right] !== safe[left]) return safe[right] - safe[left];
      return left - right;
    });
  for (const index of ranked) {
    if (leftover <= 0) break;
    seats[index] += 1;
    leftover -= 1;
  }
  let guard = 0;
  while (seats.some((seat) => seat < 1) && guard < count * minimum) {
    guard += 1;
    const needy = seats.findIndex((seat) => seat < 1);
    const donors = seats
      .map((seat, index) => ({ seat, index }))
      .filter((row) => row.seat > 1);
    if (needy < 0 || donors.length === 0) {
      return `Minimum primary questions (${minimum}) cannot cover all ${count} required rubrics.`;
    }
    const donor = donors.reduce((best, row) =>
      row.seat > best.seat || (row.seat === best.seat && safe[row.index] > safe[best.index]) ? row : best,
    );
    seats[donor.index] -= 1;
    seats[needy] += 1;
  }
  if (seats.reduce((sum, seat) => sum + seat, 0) !== minimum || seats.some((seat) => seat < 1)) {
    return `Minimum primary questions (${minimum}) cannot cover all ${count} required rubrics.`;
  }
  return seats;
}
