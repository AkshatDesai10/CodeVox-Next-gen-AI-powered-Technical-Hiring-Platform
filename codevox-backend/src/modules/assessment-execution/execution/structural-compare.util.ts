import { normalizeOutput, normalizeSqlOutput, normalizeStructuralOutput } from '../utils/output.util';

function parseJsonLoose(value: string): unknown | null {
  const trimmed = normalizeOutput(value);
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}

export type HttpExpectedShape = {
  expected_status?: number;
  expected_body?: unknown;
};

export function parseHttpExpected(expectedOutput: string): HttpExpectedShape | null {
  const parsed = parseJsonLoose(expectedOutput);
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (!('expected_body' in row) && !('expected_status' in row)) return null;
  return {
    expected_status:
      row.expected_status != null ? Number(row.expected_status) : undefined,
    expected_body: row.expected_body,
  };
}

/** Structural response comparison — JSON deep-equal, never raw string diff. */
export function responsesMatch(
  actualStdout: string,
  expectedOutput: string,
  options?: { sql?: boolean; actualStatus?: number },
): boolean {
  if (options?.sql) {
    return normalizeSqlOutput(actualStdout) === normalizeSqlOutput(expectedOutput);
  }

  const httpExpected = parseHttpExpected(expectedOutput);
  if (httpExpected) {
    if (
      httpExpected.expected_status != null &&
      options?.actualStatus != null &&
      httpExpected.expected_status !== options.actualStatus
    ) {
      return false;
    }
    const actualBody = parseJsonLoose(actualStdout);
    if (actualBody != null && httpExpected.expected_body != null) {
      return deepEqual(actualBody, httpExpected.expected_body);
    }
  }

  const normalizedActual = normalizeOutput(actualStdout);
  const normalizedExpected = normalizeOutput(expectedOutput);
  if (normalizedActual === normalizedExpected) return true;

  const structuralActual = normalizeStructuralOutput(actualStdout);
  const structuralExpected = normalizeStructuralOutput(expectedOutput);
  return (
    structuralActual !== null &&
    structuralExpected !== null &&
    structuralActual === structuralExpected
  );
}
