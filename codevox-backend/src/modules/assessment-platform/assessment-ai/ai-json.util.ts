export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  let jsonText = fenced ? fenced[1].trim() : trimmed;

  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start >= 0 && end > start) {
    jsonText = jsonText.slice(start, end + 1);
  }
  return jsonText;
}

/**
 * Gemini often stops mid-grade (unclosed arrays/objects, sometimes mid-string).
 * Keep every complete value and close the containers that were left open.
 */
export function salvageTruncatedJson(input: string): string {
  let cut = input.trim().replace(/,\s*$/, '');
  const scan = (src: string) => {
    let inString = false;
    let escape = false;
    const stack: Array<'{' | '['> = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') stack.pop();
    }
    return { inString, stack };
  };

  let state = scan(cut);
  if (state.inString) {
    const q = cut.lastIndexOf('"');
    if (q >= 0) cut = cut.slice(0, q);
    cut = cut.replace(/,\s*"[^"]*$/, '').replace(/:\s*$/, '').replace(/,\s*$/, '');
    state = scan(cut);
  }
  while (state.stack.length) {
    const open = state.stack.pop();
    cut += open === '{' ? '}' : ']';
  }
  return cut;
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const jsonText = extractJsonText(content);
  if (!jsonText) throw new Error('LLM returned empty content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    try {
      parsed = JSON.parse(salvageTruncatedJson(jsonText));
    } catch {
      console.error('--- BROKEN JSON TEXT FROM LLM ---');
      console.error(jsonText);
      console.error('-----------------------------------');
      throw err;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM JSON root must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    throw new Error('LLM returned empty JSON object');
  }
  return obj;
}
