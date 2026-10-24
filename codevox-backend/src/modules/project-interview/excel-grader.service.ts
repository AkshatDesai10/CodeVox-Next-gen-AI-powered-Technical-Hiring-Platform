import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';

/** Metadata / examiner tabs — never graded (student does not fill these). */
const IGNORE_SHEET_PATTERNS = [
  /^instructions?/i,
  /^marking\s*guide/i,
  /^mark\s*scheme/i,
  /^examiner\s*score/i,
  /^cover/i,
  /^readme$/i,
];

const NUM_ABS_TOLERANCE = 0.05;
const NUM_REL_TOLERANCE = 0.001;

export type ExcelCellIssue =
  | 'mismatch'
  | 'formula_missing_hardcoded'
  | 'empty'
  | 'sheet_missing';

export type ExcelMistake = {
  sheet: string;
  cell: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
  issue: ExcelCellIssue;
  expected_had_formula: boolean;
  actual_had_formula: boolean;
  topic_tag?: string;
};

export type ExcelEvaluationResult = {
  score_pct: number;
  total_checks: number;
  passed_checks: number;
  hardcoded_cells_detected: string[];
  ignored_sheets: string[];
  graded_sheets: string[];
  answer_cell_count: number;
  mistakes: ExcelMistake[];
  /** Compact hints for defense question synthesis (no key values). */
  gap_summary: string[];
};

type CellSnap = {
  address: string;
  value: string | number | boolean | null;
  formula: string | null;
};

function sheetIgnored(name: string): boolean {
  const n = name.trim();
  return IGNORE_SHEET_PATTERNS.some((re) => re.test(n));
}

function normalizeText(v: string): string {
  return v.replace(/\s+/g, ' ').trim().toLowerCase();
}

function coerceComparable(raw: unknown): string | number | boolean | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    const asNum = Number(t.replace(/,/g, ''));
    if (t !== '' && Number.isFinite(asNum) && /^-?\d/.test(t.replace(/,/g, ''))) return asNum;
    return t;
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.result !== undefined) return coerceComparable(o.result);
    if (typeof o.text === 'string') return coerceComparable(o.text);
    if (Array.isArray(o.richText)) {
      return coerceComparable(
        (o.richText as Array<{ text?: string }>).map((x) => x.text ?? '').join(''),
      );
    }
    if (o.formula != null && o.result !== undefined) return coerceComparable(o.result);
  }
  return null;
}

function extractFormula(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.formula === 'string' && o.formula.trim()) return o.formula.trim();
  if (typeof o.sharedFormula === 'string' && o.sharedFormula.trim()) return o.sharedFormula.trim();
  return null;
}

function valuesEqual(
  expected: string | number | boolean | null,
  actual: string | number | boolean | null,
): boolean {
  if (expected == null && actual == null) return true;
  if (expected == null || actual == null) return false;
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
    const abs = Math.abs(expected - actual);
    if (abs <= NUM_ABS_TOLERANCE) return true;
    if (Math.abs(expected) > 1e-9 && abs / Math.abs(expected) <= NUM_REL_TOLERANCE) return true;
    // Volatile-ish dates: treat same calendar day as equal when both look like Excel serials/dates.
    if (expected > 20000 && actual > 20000 && Math.abs(Math.floor(expected) - Math.floor(actual)) === 0) {
      return true;
    }
    return false;
  }
  if (typeof expected === 'boolean' || typeof actual === 'boolean') {
    return Boolean(expected) === Boolean(actual);
  }
  return normalizeText(String(expected)) === normalizeText(String(actual));
}

function sheetCellMap(ws: ExcelJS.Worksheet): Map<string, CellSnap> {
  const map = new Map<string, CellSnap>();
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const address = cell.address;
      const formula = extractFormula(cell.value) ?? (cell.formula ? String(cell.formula) : null);
      map.set(address, {
        address,
        value: coerceComparable(cell.value),
        formula: formula ? formula.replace(/^=/, '') : null,
      });
    });
  });
  return map;
}

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

function topicTagForSheet(name: string): string {
  const n = name.toLowerCase();
  if (/lookup|vlookup|xlookup|match/i.test(n)) return 'lookups';
  if (/pivot|summary|dash/i.test(n)) return 'analysis';
  if (/sales|invoice|finance|tax|payroll|mark/i.test(n)) return 'business_logic';
  return 'formulas';
}

/**
 * Format-agnostic Excel grader.
 * Answer cells = cells where the Master Answer Key differs from the Problem Sheet.
 */
@Injectable()
export class ExcelGraderService {
  private readonly logger = new Logger(ExcelGraderService.name);

  async grade(input: {
    problemBuffer: Buffer;
    answerKeyBuffer: Buffer;
    candidateBuffer: Buffer;
  }): Promise<ExcelEvaluationResult> {
    const [problemWb, keyWb, candWb] = await Promise.all([
      loadWorkbook(input.problemBuffer),
      loadWorkbook(input.answerKeyBuffer),
      loadWorkbook(input.candidateBuffer),
    ]);

    const ignored_sheets: string[] = [];
    const graded_sheets: string[] = [];
    const mistakes: ExcelMistake[] = [];
    const hardcoded_cells_detected: string[] = [];
    let total_checks = 0;
    let passed_checks = 0;
    let answer_cell_count = 0;

    for (const keySheet of keyWb.worksheets) {
      const name = keySheet.name;
      if (sheetIgnored(name)) {
        ignored_sheets.push(name);
        continue;
      }

      const problemSheet = problemWb.getWorksheet(name);
      const candSheet = candWb.getWorksheet(name);
      if (!candSheet) {
        mistakes.push({
          sheet: name,
          cell: '—',
          expected: 'sheet present',
          actual: null,
          issue: 'sheet_missing',
          expected_had_formula: false,
          actual_had_formula: false,
          topic_tag: topicTagForSheet(name),
        });
        total_checks += 1;
        continue;
      }

      const keyMap = sheetCellMap(keySheet);
      const problemMap = problemSheet ? sheetCellMap(problemSheet) : new Map<string, CellSnap>();
      const candMap = sheetCellMap(candSheet);
      let sheetHadAnswerCells = false;

      for (const [addr, keyCell] of keyMap) {
        const problemCell = problemMap.get(addr);
        if (!this.isAnswerCell(keyCell, problemCell)) continue;

        sheetHadAnswerCells = true;
        answer_cell_count += 1;
        total_checks += 1;

        const candCell = candMap.get(addr);
        const expected = keyCell.value;
        const actual = candCell?.value ?? null;
        const expectedHadFormula = Boolean(keyCell.formula);
        const actualHadFormula = Boolean(candCell?.formula);

        if (actual == null || (typeof actual === 'string' && !String(actual).trim())) {
          mistakes.push({
            sheet: name,
            cell: addr,
            expected,
            actual: null,
            issue: 'empty',
            expected_had_formula: expectedHadFormula,
            actual_had_formula: false,
            topic_tag: topicTagForSheet(name),
          });
          continue;
        }

        if (!valuesEqual(expected, actual)) {
          mistakes.push({
            sheet: name,
            cell: addr,
            expected,
            actual,
            issue: 'mismatch',
            expected_had_formula: expectedHadFormula,
            actual_had_formula: actualHadFormula,
            topic_tag: topicTagForSheet(name),
          });
          continue;
        }

        if (expectedHadFormula && !actualHadFormula) {
          hardcoded_cells_detected.push(`${name}!${addr}`);
          mistakes.push({
            sheet: name,
            cell: addr,
            expected,
            actual,
            issue: 'formula_missing_hardcoded',
            expected_had_formula: true,
            actual_had_formula: false,
            topic_tag: topicTagForSheet(name),
          });
          passed_checks += 0.5;
          continue;
        }

        passed_checks += 1;
      }

      if (sheetHadAnswerCells) graded_sheets.push(name);
    }

    const score_pct =
      total_checks > 0
        ? Math.round(Math.min(100, Math.max(0, (passed_checks / total_checks) * 100)))
        : 0;

    // Gap lines for viva — never include expected key values.
    const gap_summary = mistakes.slice(0, 12).map((m) => {
      if (m.issue === 'sheet_missing') return `Missing sheet "${m.sheet}"`;
      if (m.issue === 'empty') return `${m.sheet}!${m.cell} left blank`;
      if (m.issue === 'formula_missing_hardcoded') {
        return `${m.sheet}!${m.cell} correct value but hardcoded (no formula)`;
      }
      return `${m.sheet}!${m.cell} calculated output mismatched`;
    });

    this.logger.log(
      `Excel grade score=${score_pct}% checks=${passed_checks}/${total_checks} answer_cells=${answer_cell_count} mistakes=${mistakes.length}`,
    );

    return {
      score_pct,
      total_checks,
      passed_checks: Math.round(passed_checks * 100) / 100,
      hardcoded_cells_detected,
      ignored_sheets,
      graded_sheets,
      answer_cell_count,
      mistakes: mistakes.slice(0, 200),
      gap_summary,
    };
  }

  private isAnswerCell(key: CellSnap, problem: CellSnap | undefined): boolean {
    if (key.formula) {
      if (!problem?.formula) return true;
      if (normalizeText(key.formula) !== normalizeText(problem.formula)) return true;
      return !valuesEqual(key.value, problem.value ?? null);
    }
    if (key.value == null) return false;
    if (!problem) return true;
    return !valuesEqual(key.value, problem.value);
  }
}
