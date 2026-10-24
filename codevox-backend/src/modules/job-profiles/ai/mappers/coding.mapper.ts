import type { AiGenerationConfig, GenerateFlags } from '../types';
import { composeCodingStatementMarkdown } from '../builders/MarkdownBuilder';

function coalesceString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function unwrapNestedRaw(raw: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['draft', 'data', 'result', 'response', 'output'] as const) {
    const nested = raw[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return { ...raw, ...(nested as Record<string, unknown>) };
    }
  }
  return raw;
}

function normalizeLanguageMap(value: unknown, languages: string[]): Record<string, string> {
  const primary = languages[0] ?? 'javascript';
  if (typeof value === 'string' && value.trim()) return { [primary]: value.trim() };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const obj = value as Record<string, unknown>;
  if (typeof obj.language_code === 'string' && obj.language_code.trim()) {
    return { [primary]: obj.language_code.trim() };
  }

  const entries = Object.entries(obj).filter(([, v]) => typeof v === 'string' && v.trim());
  if (entries.length === 1) {
    const [key, code] = entries[0]!;
    const lang = languages.includes(key) ? key : primary;
    return { [lang]: String(code).trim() };
  }

  return Object.fromEntries(
    entries.map(([key, code]) => [key.toLowerCase(), String(code).trim()]),
  );
}

export function normalizeCodingAiRaw(
  raw: Record<string, unknown>,
  languages: string[] = ['javascript'],
): Record<string, unknown> {
  const out = { ...unwrapNestedRaw(raw) };

  out.problem_title = coalesceString(out.problem_title, out.problemTitle, out.title);
  out.problem_statement = coalesceString(
    out.problem_statement,
    out.problemStatement,
    out.description,
    out.statement,
  );
  out.input_format = coalesceString(out.input_format, out.inputFormat);
  out.output_format = coalesceString(out.output_format, out.outputFormat);

  if (!out.constraints && out.constraint && typeof out.constraint === 'object') {
    out.constraints = out.constraint;
  }

  out.starter_code = normalizeLanguageMap(out.starter_code ?? out.starterCode, languages);
  out.internal_solution = normalizeLanguageMap(
    out.internal_solution ?? out.internalSolution ?? out.solution ?? raw.referenceSolution,
    languages,
  );

  if (Array.isArray(raw.visibleTestCases) || Array.isArray(raw.hiddenTestCases)) {
    const combined: any[] = [];
    if (Array.isArray(raw.visibleTestCases)) {
      for (const t of raw.visibleTestCases) {
        combined.push({
          input_value: (t as any).input,
          expected_output: (t as any).expectedOutput,
          explanation: (t as any).explanation,
          is_visible: 1,
          is_edge_case: 0
        });
      }
    }
    if (Array.isArray(raw.hiddenTestCases)) {
      for (const t of raw.hiddenTestCases) {
        combined.push({
          input_value: (t as any).input,
          expected_output: (t as any).expectedOutput,
          is_visible: 0,
          is_edge_case: 1
        });
      }
    }
    out.test_cases = combined;
  } else if (!Array.isArray(out.test_cases) && Array.isArray(out.testCases)) {
    out.test_cases = out.testCases;
  }

  return out;
}

export function isCodingRawUsable(raw: Record<string, unknown>): boolean {
  return coalesceString(raw.problem_statement, raw.problemStatement, raw.description).length >= 24;
}

import { BadRequestException } from '@nestjs/common';

export function ensureCodingRaw(
  raw: Record<string, unknown>,
  _fallback: Record<string, unknown>,
  languages: string[],
): Record<string, unknown> {
  const normalized = normalizeCodingAiRaw(raw, languages);
  
  if (!isCodingRawUsable(normalized)) {
    throw new BadRequestException('Failed to fetch');
  }

  return normalized;
}

function stringifyTestCaseValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeProblemDifficulty(value: string | undefined) {
  const d = (value ?? 'medium').toLowerCase();
  if (d === 'easy' || d === 'hard') return d;
  return 'medium';
}

export function mapCodingAiResult(
  raw: Record<string, unknown>,
  input: AiGenerationConfig,
  generate?: GenerateFlags,
) {
  const normalized = normalizeCodingAiRaw(raw, input.languages);
  const gen = generate ?? input.generate ?? {};
  const constraints = (normalized.constraints ?? {}) as Record<string, unknown>;
  const statementMd =
    gen.problem_statement === false
      ? undefined
      : composeCodingStatementMarkdown({
          problem_statement: coalesceString(normalized.problem_statement),
          input_format: normalized.input_format ? String(normalized.input_format) : undefined,
          output_format: normalized.output_format ? String(normalized.output_format) : undefined,
          examples: Array.isArray(normalized.examples)
            ? normalized.examples.map((row) => {
                const item = row as Record<string, unknown>;
                return {
                  input: item.input != null ? stringifyTestCaseValue(item.input) : undefined,
                  output: item.output != null ? stringifyTestCaseValue(item.output) : undefined,
                  explanation: item.explanation != null ? String(item.explanation) : undefined,
                };
              })
            : [],
          edge_cases: Array.isArray(normalized.edge_cases)
            ? normalized.edge_cases.map((item) => String(item))
            : [],
          constraints: {
            input_size: constraints.inputSize ? String(constraints.inputSize) : constraints.input_size ? String(constraints.input_size) : input.max_input_size,
            value_range: constraints.valueRange ? String(constraints.valueRange) : constraints.value_range ? String(constraints.value_range) : input.value_range,
            time_limit: constraints.timeLimitMs ? String(constraints.timeLimitMs) : constraints.time_limit ? String(constraints.time_limit) : input.time_limit,
            memory_limit: constraints.memoryLimitMb ? String(constraints.memoryLimitMb) : constraints.memory_limit ? String(constraints.memory_limit) : input.memory_limit,
            efficiency_note: constraints.efficiency_note ? String(constraints.efficiency_note) : undefined,
          },
        });

  const starterRaw = (normalized.starter_code ?? {}) as Record<string, string>;
  const solutionRaw = (normalized.internal_solution ?? {}) as Record<string, string>;
  const languages = input.languages.length ? input.languages : Object.keys(starterRaw);

  return {
    title: coalesceString(normalized.problem_title, `${input.problem_pattern ?? 'Challenge'} — ${input.topic_tag}`),
    statement_md: statementMd,
    difficulty: normalizeProblemDifficulty(String(normalized.difficulty ?? input.difficulty)),
    topic_tags: Array.isArray(normalized.topic_tags)
      ? normalized.topic_tags.map((tag) => String(tag))
      : [input.topic_tag],
    starter_code:
      gen.starter_code === false
        ? undefined
        : Object.fromEntries(languages.map((lang) => [lang, starterRaw[lang] ?? starterRaw[lang.toLowerCase()] ?? ''])),
    internal_solution:
      gen.internal_solution === false
        ? undefined
        : Object.fromEntries(
            languages.map((lang) => [lang, solutionRaw[lang] ?? solutionRaw[lang.toLowerCase()] ?? '']),
          ),
    suggested_test_cases:
      gen.test_cases === false || !Array.isArray(normalized.test_cases)
        ? undefined
        : normalized.test_cases.map((row) => {
            const item = row as Record<string, unknown>;
            return {
              input_value: stringifyTestCaseValue(item.input_value ?? item.input ?? ''),
              expected_output: stringifyTestCaseValue(item.expected_output ?? item.output ?? ''),
              is_visible: Number(item.is_visible ?? 1),
              is_edge_case: Number(item.is_edge_case ?? 0),
            };
          }),
    time_complexity:
      gen.complexity_analysis === false ? undefined : coalesceString(normalized.time_complexity),
    space_complexity:
      gen.complexity_analysis === false ? undefined : coalesceString(normalized.space_complexity),
    hints:
      gen.hints && Array.isArray(normalized.hints)
        ? normalized.hints.map((hint) => String(hint)).slice(0, 3)
        : undefined,
    solution_explanation: normalized.solution_explanation
      ? String(normalized.solution_explanation)
      : undefined,
    validation_notes: normalized.validation_notes ? String(normalized.validation_notes) : undefined,
    constraints_suggested: {
      input_size: constraints.inputSize ? String(constraints.inputSize) : constraints.input_size ? String(constraints.input_size) : input.max_input_size ?? '1 ≤ n ≤ 10^5',
      value_range: constraints.valueRange ? String(constraints.valueRange) : constraints.value_range ? String(constraints.value_range) : input.value_range ?? '1 ≤ val ≤ 10^9',
      memory_mb: constraints.memoryLimitMb ? Number(constraints.memoryLimitMb) : input.memory_limit_mb ?? 256,
      time_limit_ms: constraints.timeLimitMs ? Number(constraints.timeLimitMs) : input.time_limit_ms ?? 2000,
    },
    quality_checklist_passed: normalized.quality_checklist_passed !== false,
    requires_sandbox_database: Boolean(
      normalized.requires_sandbox_database ?? input.requires_sandbox_database,
    ),
    database_schema:
      gen.database_schema === false
        ? undefined
        : (() => {
            const schemaBlock = normalized.database_schema as Record<string, unknown> | undefined;
            if (!schemaBlock?.ddl_sql) return undefined;
            return {
              ddl_sql: String(schemaBlock.ddl_sql),
              tables: Array.isArray(schemaBlock.tables) ? schemaBlock.tables : [],
            };
          })(),
    seed_data:
      gen.seed_data === false
        ? undefined
        : (() => {
            const seedBlock = normalized.seed_data as Record<string, unknown> | undefined;
            if (!seedBlock?.insert_sql) return undefined;
            return {
              random_seed: seedBlock.random_seed ?? input.seed_options?.random_seed ?? 42,
              size: seedBlock.size ?? input.seed_options?.size ?? 'medium',
              insert_sql: String(seedBlock.insert_sql),
              row_counts: seedBlock.row_counts ?? {},
            };
          })(),
  };
}

export function buildCodingFallbackRaw(input: AiGenerationConfig): Record<string, unknown> {
  const primaryLang = input.languages[0] ?? 'javascript';

  const starterByLang: Record<string, string> = {
    python: [
      'import sys',
      'import json',
      '',
      'def solve(data):',
      '    # TODO: write your solution here',
      '    pass',
      '',
      'if __name__ == "__main__":',
      '    raw = sys.stdin.read().strip()',
      '    data = json.loads(raw)',
      '    result = solve(data)',
      '    print(result)',
    ].join('\n'),
    javascript: [
      'process.stdin.resume();',
      'process.stdin.setEncoding("utf8");',
      'let input = "";',
      'process.stdin.on("data", d => input += d);',
      'process.stdin.on("end", () => {',
      '    const data = JSON.parse(input.trim());',
      '    function solve(data) {',
      '        // TODO: write your solution here',
      '    }',
      '    const result = solve(data);',
      '    console.log(result);',
      '});',
    ].join('\n'),
    php: [
      '<?php',
      '$raw = trim(stream_get_contents(STDIN));',
      '$data = json_decode($raw, true);',
      '',
      'function solve($data) {',
      '    // TODO: write your solution here',
      '}',
      '',
      '$result = solve($data);',
      'echo $result . PHP_EOL;',
      '?>',
    ].join('\n'),
  };

  const starterSnippet = starterByLang[primaryLang] ?? starterByLang['javascript'];

  const base: Record<string, unknown> = {
    problem_title: `${input.problem_pattern ?? 'Challenge'} — ${input.topic_tag}`,
    difficulty: normalizeProblemDifficulty(input.difficulty),
    topic_tags: [input.topic_tag],
    problem_statement: `Design and implement a ${(input.problem_pattern ?? 'challenge').toLowerCase()} solution for a ${input.job_profile} assessment.\n\nYou are building a self-contained module that a ${input.seniority} engineer would implement during a technical screen.`,
    input_format: 'A single JSON-encoded input object passed to solve().',
    output_format: 'Return the computed result in the format described in the examples.',
    constraints: {
      input_size: input.max_input_size ?? '1 ≤ n ≤ 10^5',
      value_range: input.value_range ?? '1 ≤ val ≤ 10^9',
      time_limit: input.time_limit ?? '2000 ms',
      memory_limit: input.memory_limit ?? '256 MB',
      efficiency_note: `Inputs up to ${input.max_input_size ?? '10^5'} require an algorithm better than brute force.`,
    },
    examples: [
      {
        input: '{"capacity":2,"operations":[["put",1,1],["get",1]]}',
        output: '[null,1]',
        explanation: 'Basic put/get sequence within capacity.',
      },
    ],
    edge_cases: ['Empty input', 'Minimum boundary values', 'Maximum boundary values'],
    time_complexity: 'O(n)',
    space_complexity: 'O(1)',
    starter_code: Object.fromEntries(input.languages.map((lang) => [lang, starterByLang[lang] ?? starterByLang['javascript']])),
    solution_explanation: `Apply the ${input.problem_pattern ?? 'pattern'} using standard ${input.topic_tag} techniques.`,
    test_cases: [
      {
        label: 'sample_input_1',
        input_value: '{"capacity":2,"operations":[["put",1,1],["get",1]]}',
        expected_output: '[null,1]',
        is_visible: 1,
        is_edge_case: 0,
      },
      {
        label: 'sample_input_2',
        input_value: '{"capacity":1,"operations":[["put",2,1],["put",3,2],["get",2]]}',
        expected_output: '[null,null,-1]',
        is_visible: 1,
        is_edge_case: 0,
      },
      {
        label: 'boundary_min',
        input_value: '{"capacity":1,"operations":[["get",1]]}',
        expected_output: '[-1]',
        is_visible: 0,
        is_edge_case: 1,
      },
      {
        label: 'boundary_max',
        input_value: '{"capacity":3,"operations":[["put",1,1],["put",2,2],["put",3,3],["get",1]]}',
        expected_output: '[null,null,null,1]',
        is_visible: 0,
        is_edge_case: 1,
      },
      {
        label: 'stress_case',
        input_value: '{"capacity":100,"operations":[["put",1,1],["get",1],["put",2,2]]}',
        expected_output: '[null,1,null]',
        is_visible: 0,
        is_edge_case: 0,
      },
    ],
    hints: [
      `Consider how ${(input.problem_pattern ?? 'the pattern').toLowerCase()} maps to ${input.topic_tag.toLowerCase()}.`,
      'Identify the core state you must maintain across operations.',
      'Use a structure that supports O(1) or O(log n) updates within the given limits.',
    ],
    validation_notes: 'Compare normalized JSON output strings exactly.',
    quality_checklist_passed: true,
  };

  if (input.requires_sandbox_database) {
    const seed = input.seed_options?.random_seed ?? 42;
    const size = input.seed_options?.size ?? 'small';
    base.requires_sandbox_database = true;
    base.database_schema = {
      ddl_sql: `CREATE TABLE users (\n  id INT PRIMARY KEY,\n  email VARCHAR(255) NOT NULL UNIQUE,\n  status VARCHAR(32) NOT NULL\n);\n\nCREATE TABLE orders (\n  id INT PRIMARY KEY,\n  user_id INT NOT NULL,\n  amount DECIMAL(10,2) NOT NULL,\n  FOREIGN KEY (user_id) REFERENCES users(id)\n);`,
      tables: [
        { name: 'users', purpose: 'User accounts' },
        { name: 'orders', purpose: 'Orders per user' },
      ],
    };
    base.seed_data = {
      random_seed: seed,
      size,
      insert_sql: `INSERT INTO users (id, email, status) VALUES (1, 'alice@example.com', 'active'), (2, 'bob@example.com', 'inactive');\nINSERT INTO orders (id, user_id, amount) VALUES (1, 1, 49.99), (2, 1, 12.50), (3, 2, 99.00);`,
      row_counts: { users: 2, orders: 3 },
    };
    base.problem_statement = `Implement a ${(input.problem_pattern ?? 'database-backed').toLowerCase()} solution that queries the pre-loaded sandbox database.\n\nThe platform loads the schema and seed data before your code runs. Use the provided tables to compute the required result for each test case.`;
    base.starter_code = Object.fromEntries(
      input.languages.map((lang) => [
        lang,
        primaryLang === 'python'
          ? 'class Solution:\n    def solve(self, input_data):\n        # Query the sandbox DB (connection provided by runtime)\n        pass\n'
          : starterSnippet,
      ]),
    );
  }

  return base;
}
