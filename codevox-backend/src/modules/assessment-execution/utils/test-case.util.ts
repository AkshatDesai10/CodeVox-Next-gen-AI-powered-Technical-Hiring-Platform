export type ResolvedTestCase = {
  id: string;
  input: string;
  expectedOutput: string;
  isHidden: number;
};

export function isHttpRequestPayload(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if ('method' in obj && 'path' in obj) return true;
  if ('body' in obj && Object.keys(obj).length === 1) return true;
  if (
    'query' in obj &&
    typeof obj.query === 'object' &&
    obj.query !== null &&
    !Array.isArray(obj.query) &&
    Object.keys(obj).length === 1
  ) {
    return true;
  }
  return false;
}

export function formatTestCaseInputForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (isHttpRequestPayload(value)) {
    const req = value as Record<string, unknown>;
    const method = req.method ? String(req.method).toUpperCase() : 'POST';
    const path = req.path ? String(req.path) : '/';
    if (req.method && req.path) {
      const lines = [`${method} ${path}`];
      if (req.headers && typeof req.headers === 'object') {
        const headerLines = Object.entries(req.headers as Record<string, unknown>)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `  ${k}: ${String(v)}`);
        if (headerLines.length) {
          lines.push('Headers:', ...headerLines);
        }
      }
      if (req.body != null) {
        const body =
          typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
        lines.push('Body:', body);
      }
      return lines.join('\n');
    }
    return JSON.stringify(req, null, 2);
  }
  return JSON.stringify(value, null, 2);
}

export function serializeTestCaseInputForExecution(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatTestCaseExpectedForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('expected_body' in obj || 'expected_status' in obj) {
      const lines: string[] = [];
      if (obj.expected_status != null) {
        lines.push(`Status: ${String(obj.expected_status)}`);
      }
      if (obj.expected_body != null) {
        const body =
          typeof obj.expected_body === 'string'
            ? obj.expected_body
            : JSON.stringify(obj.expected_body, null, 2);
        lines.push('Body:', body);
      }
      return lines.join('\n');
    }
  }
  return JSON.stringify(value, null, 2);
}

export function serializeTestCaseExpectedForExecution(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.expected_body != null) {
      return typeof obj.expected_body === 'string'
        ? obj.expected_body
        : JSON.stringify(obj.expected_body);
    }
  }
  return JSON.stringify(value);
}

export function readJsonTestCases(
  questionJson: Record<string, unknown> | null | undefined,
  evalConfig: Record<string, unknown> | null | undefined,
): Array<Record<string, unknown>> {
  if (Array.isArray(questionJson?.testCases)) {
    return questionJson.testCases as Array<Record<string, unknown>>;
  }
  if (Array.isArray(evalConfig?.testCases)) {
    return evalConfig.testCases as Array<Record<string, unknown>>;
  }
  return [];
}

export function mapJsonTestCases(
  rows: Array<Record<string, unknown>>,
  options?: { includeHidden?: boolean; forExecution?: boolean },
): ResolvedTestCase[] {
  const includeHidden = options?.includeHidden ?? true;
  const forExecution = options?.forExecution ?? false;
  const formatInput = forExecution
    ? serializeTestCaseInputForExecution
    : formatTestCaseInputForDisplay;
  const formatExpected = forExecution
    ? serializeTestCaseExpectedForExecution
    : formatTestCaseExpectedForDisplay;

  return rows
    .filter((tc) => includeHidden || (!tc.isHidden && !tc.is_hidden))
    .map((tc, index) => ({
      id: String(tc.id ?? index + 1),
      input: formatInput(tc.input),
      expectedOutput: formatExpected(tc.expectedOutput ?? tc.expected_output),
      isHidden: tc.isHidden || tc.is_hidden ? 1 : 0,
    }));
}
