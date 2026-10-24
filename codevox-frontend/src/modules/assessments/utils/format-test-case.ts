export function isHttpRequestPayload(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'method' in value &&
    'path' in value
  );
}

export function formatTestCaseInputForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (isHttpRequestPayload(value)) {
    const req = value as Record<string, unknown>;
    const method = String(req.method).toUpperCase();
    const path = String(req.path);
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
  return JSON.stringify(value, null, 2);
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

export function formatTestCaseField(value: unknown, kind: 'input' | 'output'): string {
  return kind === 'input'
    ? formatTestCaseInputForDisplay(value)
    : formatTestCaseExpectedForDisplay(value);
}
