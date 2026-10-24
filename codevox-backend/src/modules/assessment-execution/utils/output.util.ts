export function normalizeOutput(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

/** Coerce AI-generated test case fields to DB text columns. */
export function serializeTestCaseValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Sort data rows so SQL result order does not affect pass/fail. */
export function normalizeSqlOutput(value: string) {
  const normalized = normalizeOutput(value);
  if (!normalized) return '';
  const lines = normalized.split('\n');
  if (lines.length <= 1) return normalized;
  const header = lines[0];
  const rows = lines.slice(1).sort();
  return [header, ...rows].join('\n');
}

function sortIndexPairs(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return [];
  if (Array.isArray(value[0])) {
    return value
      .map((pair) => (Array.isArray(pair) ? [...pair].sort((a, b) => a - b) : pair))
      .sort((a, b) => {
        if (!Array.isArray(a) || !Array.isArray(b)) return 0;
        return a[0] - b[0] || a[1] - b[1];
      });
  }
  return value;
}

/** Normalize JSON or Python list/tuple repr e.g. [(0, 1)] -> [[0,1]]. */
export function normalizeStructuralOutput(value: string): string | null {
  const trimmed = normalizeOutput(value);
  if (!trimmed) return '[]';

  const candidates = [trimmed, trimmed.replace(/\(/g, '[').replace(/\)/g, ']')];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return JSON.stringify(sortIndexPairs(parsed));
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function outputsMatch(
  actual: string,
  expected: string,
  options?: { sql?: boolean },
) {
  if (options?.sql) {
    return normalizeSqlOutput(actual) === normalizeSqlOutput(expected);
  }

  const normalizedActual = normalizeOutput(actual);
  const normalizedExpected = normalizeOutput(expected);
  if (normalizedActual === normalizedExpected) return true;

  const structuralActual = normalizeStructuralOutput(actual);
  const structuralExpected = normalizeStructuralOutput(expected);
  return (
    structuralActual !== null &&
    structuralExpected !== null &&
    structuralActual === structuralExpected
  );
}

export const MAX_CAPTURE_BYTES = 64 * 1024;

export function appendCapped(current: string, chunk: string, maxBytes = MAX_CAPTURE_BYTES) {
  if (current.length >= maxBytes) return current;
  const remaining = maxBytes - current.length;
  return current + chunk.slice(0, remaining);
}
