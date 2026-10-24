const CODE_FENCE_RE = /```(?:\w+)?\s*([\s\S]*?)```/gi;

export function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CODE_FENCE_RE.source, CODE_FENCE_RE.flags);
  while ((match = re.exec(text)) !== null) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

export function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').trim();
}

export function pickStarterCodeBlock(blocks: string[], language?: string | null): string {
  if (!blocks.length) return '';
  const lang = language?.toUpperCase();

  if (lang === 'PHP') {
    const php = blocks.find((b) => b.includes('<?php') || /\bmysqli\b|\bPDO\b/i.test(b));
    if (php) return php;
  }
  if (lang === 'SQL') {
    const sql = blocks.find((b) => /^(CREATE|INSERT|SELECT|WITH)\b/im.test(b));
    if (sql) return sql;
  }
  if (lang === 'PYTHON') {
    const py = blocks.find((b) => /^(import |def |class )/m.test(b));
    if (py) return py;
  }
  if (lang === 'NODE') {
    const js = blocks.find((b) => /^(const |let |function |require\()/m.test(b));
    if (js) return js;
  }

  return blocks.find((b) => b.includes('<?php')) ?? blocks[blocks.length - 1];
}

export function extractStarterCodeFromText(text: string, language?: string | null): string {
  return pickStarterCodeBlock(extractCodeBlocks(text), language);
}
