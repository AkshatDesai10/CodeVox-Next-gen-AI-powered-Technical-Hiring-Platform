import type { AiGenerationConfig, GenerateFlags } from '../types';
import { composeDatabaseStatementMarkdown } from '../builders/MarkdownBuilder';
import { BadRequestException } from '@nestjs/common';

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

export function normalizeDatabaseAiRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...unwrapNestedRaw(raw) };
  out.problem_title = coalesceString(out.problem_title, out.problemTitle, out.title);
  out.problem_statement = coalesceString(
    out.problem_statement,
    out.problemStatement,
    out.description,
    out.statement,
  );
  out.scenario_description = coalesceString(out.scenario_description, out.scenarioDescription);
  return out;
}

export function isDatabaseRawUsable(raw: Record<string, unknown>): boolean {
  return coalesceString(raw.problem_statement, raw.problemStatement, raw.scenario_description).length >= 24;
}

export function ensureDatabaseRaw(
  raw: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = normalizeDatabaseAiRaw(raw);
  const fb = normalizeDatabaseAiRaw(fallback);
  if (!isDatabaseRawUsable(normalized)) {
    throw new BadRequestException('Failed to fetch');
  }

  const merged: Record<string, unknown> = { ...fb, ...normalized };
  if (!coalesceString(normalized.problem_statement)) merged.problem_statement = fb.problem_statement;
  if (!coalesceString(normalized.scenario_description)) {
    merged.scenario_description = fb.scenario_description;
  }

  const schema = (normalized.database_schema ?? {}) as Record<string, unknown>;
  const fbSchema = (fb.database_schema ?? {}) as Record<string, unknown>;
  if (!schema.ddl_sql && fbSchema.ddl_sql) {
    merged.database_schema = { ...fbSchema, ...schema };
  }

  const seed = (normalized.seed_data ?? {}) as Record<string, unknown>;
  const fbSeed = (fb.seed_data ?? {}) as Record<string, unknown>;
  if (!seed.insert_sql && fbSeed.insert_sql) {
    merged.seed_data = { ...fbSeed, ...seed };
  }

  return merged;
}

export function mapDatabaseAiResult(
  raw: Record<string, unknown>,
  input: AiGenerationConfig,
  generate?: GenerateFlags,
) {
  const normalized = normalizeDatabaseAiRaw(raw);
  const gen = generate ?? input.generate ?? {};
  const schemaBlock = normalized.database_schema as Record<string, unknown> | undefined;
  const seedBlock = normalized.seed_data as Record<string, unknown> | undefined;

  const statementMd =
    gen.problem_statement === false
      ? undefined
      : composeDatabaseStatementMarkdown({
          problem_statement: coalesceString(normalized.problem_statement),
          scenario_description: normalized.scenario_description
            ? String(normalized.scenario_description)
            : undefined,
          entity_descriptions: Array.isArray(normalized.entity_descriptions)
            ? normalized.entity_descriptions.map((row) => {
                const item = row as Record<string, unknown>;
                return {
                  table_name: item.table_name ? String(item.table_name) : undefined,
                  description: item.description ? String(item.description) : undefined,
                };
              })
            : [],
          relationships: Array.isArray(normalized.relationships)
            ? normalized.relationships.map((row) => {
                const item = row as Record<string, unknown>;
                if (typeof row === 'string') return row;
                return `${item.description ?? ''} (${item.from_table ?? ''} -> ${item.to_table ?? ''})`;
              })
            : [],
          supported_query_patterns: Array.isArray(normalized.supported_query_patterns)
            ? normalized.supported_query_patterns.map((p) => String(p))
            : [],
          database_schema: {
            ddl_sql: schemaBlock?.ddl_sql ? String(schemaBlock.ddl_sql) : undefined,
          },
          seed_data: {
            insert_sql: seedBlock?.insert_sql ? String(seedBlock.insert_sql) : undefined,
          }
        });

  return {
    title: coalesceString(normalized.problem_title, `${input.problem_pattern ?? 'SQL Dataset'} — ${input.topic_tag}`),
    statement_md: statementMd,
    difficulty: String(raw.difficulty ?? input.difficulty),
    topic_tags: Array.isArray(normalized.topic_tags)
      ? normalized.topic_tags.map((tag) => String(tag))
      : [input.topic_tag],
    database_type: input.database_type ?? 'MySQL',
    database_schema:
      gen.database_schema === false
        ? undefined
        : {
            ddl_sql: schemaBlock?.ddl_sql ? String(schemaBlock.ddl_sql) : undefined,
            tables: Array.isArray(schemaBlock?.tables) ? schemaBlock.tables : [],
          },
    relationships: gen.relationships === false ? undefined : normalized.relationships,
    entity_descriptions: gen.entity_descriptions === false ? undefined : normalized.entity_descriptions,
    seed_data:
      gen.seed_data === false
        ? undefined
        : {
            random_seed: seedBlock?.random_seed ?? input.seed_options?.random_seed ?? 42,
            size: seedBlock?.size ?? input.seed_options?.size ?? 'medium',
            insert_sql: seedBlock?.insert_sql ? String(seedBlock.insert_sql) : undefined,
            row_counts: seedBlock?.row_counts ?? {},
            notes: seedBlock?.notes ? String(seedBlock.notes) : undefined,
          },
    sample_queries: gen.sql_queries === false ? undefined : normalized.sample_queries,
    supported_query_patterns:
      gen.sql_queries === false
        ? undefined
        : Array.isArray(normalized.supported_query_patterns)
          ? normalized.supported_query_patterns.map((p) => String(p))
          : [],
    hints:
      gen.hints && Array.isArray(normalized.hints)
        ? normalized.hints.map((hint) => String(hint)).slice(0, 3)
        : undefined,
    quality_checklist_passed: normalized.quality_checklist_passed !== false,
    evaluationConfig: {
       ...(raw.evaluation_config ? (raw.evaluation_config as Record<string, unknown>) : {}),
       database_setup: {
          ddl_sql: schemaBlock?.ddl_sql ? String(schemaBlock.ddl_sql) : undefined,
          insert_sql: seedBlock?.insert_sql ? String(seedBlock.insert_sql) : undefined
       }
    },
  };
}

export function buildDatabaseFallbackRaw(input: AiGenerationConfig): Record<string, unknown> {
  const seed = input.seed_options?.random_seed ?? 42;
  const size = input.seed_options?.size ?? 'medium';
  return {
    problem_title: `${input.problem_pattern ?? 'Schema Design'} — ${input.topic_tag}`,
    difficulty: input.difficulty,
    topic_tags: [input.topic_tag, 'SQL', input.database_type ?? 'MySQL'],
    problem_statement: `Design and query a realistic ${input.domain.toLowerCase()} database for a ${input.seniority} ${input.job_profile} SQL assessment.`,
    scenario_description: `A ${input.domain} company needs a normalized schema supporting ${input.problem_pattern ?? 'operational reporting'}.`,
    database_schema: {
      ddl_sql: `-- Seed: ${seed}\nCREATE TABLE customers (\n  id INT PRIMARY KEY AUTO_INCREMENT,\n  email VARCHAR(255) NOT NULL UNIQUE,\n  status ENUM('active','archived') NOT NULL DEFAULT 'active',\n  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE orders (\n  id INT PRIMARY KEY AUTO_INCREMENT,\n  customer_id INT NOT NULL,\n  total DECIMAL(10,2) NOT NULL CHECK (total >= 0),\n  deleted_at TIMESTAMP NULL,\n  FOREIGN KEY (customer_id) REFERENCES customers(id)\n);\n\nCREATE INDEX idx_orders_customer ON orders(customer_id);`,
      tables: [
        { name: 'customers', purpose: 'Customer accounts with soft-archive via status' },
        { name: 'orders', purpose: 'Customer orders with soft-delete support' },
      ],
    },
    relationships: [
      { from_table: 'orders', to_table: 'customers', type: 'many-to-one', description: 'Each order belongs to one customer' },
    ],
    entity_descriptions: [
      { table_name: 'customers', description: 'End-user accounts', key_columns: ['id', 'email', 'status'] },
      { table_name: 'orders', description: 'Purchase orders', key_columns: ['id', 'customer_id', 'total'] },
    ],
    seed_data: {
      random_seed: seed,
      size,
      insert_sql: `INSERT INTO customers (id, email, status) VALUES\n(1, 'alice@example.com', 'active'),\n(2, 'bob@example.com', 'archived'),\n(3, NULL, 'active');\n\nINSERT INTO orders (id, customer_id, total, deleted_at) VALUES\n(101, 1, 49.99, NULL),\n(102, 1, 0.00, NULL),\n(103, 2, 199.50, '2024-01-15 10:00:00');`,
      row_counts: { customers: 3, orders: 3 },
      notes: 'Includes NULL email, archived customer, zero-total order, and soft-deleted order.',
    },
    supported_query_patterns: ['INNER JOIN', 'GROUP BY with HAVING', 'Filtering NULL and archived rows'],
    sample_queries: [
      { title: 'Revenue by active customer', sql: 'SELECT c.email, SUM(o.total) FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.status = \'active\' AND o.deleted_at IS NULL GROUP BY c.id;', difficulty: 'medium' },
    ],
    hints: [
      'Start by identifying which tables hold facts vs dimensions.',
      'Consider whether deleted or archived rows should be excluded in aggregates.',
      'Use JOIN + GROUP BY for per-customer metrics.',
    ],
    quality_checklist_passed: true,
  };
}

/**
 * Maps the AI JSON response for a **simple / LeetCode-style** SQL problem.
 *
 * The AI returns:
 *   - problem_statement: fully composed markdown (schema table + question + examples)
 *   - answer_sql: the single correct reference SQL query
 *   - database_schema.ddl_sql: CREATE TABLE statements
 *   - seed_data.insert_sql: INSERT statements matching the examples
 *   - sample_queries: [{ title, sql, difficulty }] with exactly the answer
 */
export function mapSimpleSqlAiResult(
  raw: Record<string, unknown>,
  input: AiGenerationConfig,
) {
  const normalized = normalizeDatabaseAiRaw(raw);
  const schemaBlock = normalized.database_schema as Record<string, unknown> | undefined;
  const seedBlock = normalized.seed_data as Record<string, unknown> | undefined;

  // The AI writes the full problem statement markdown directly (schema + question + examples)
  const statementMd = coalesceString(
    normalized.problem_statement,
    normalized.statement_md,
  ) || `Write a SQL query for the following problem.\n\n*(${input.topic_tag} - ${input.difficulty})*`;

  // answer_sql is the single correct reference query
  const answerSql = coalesceString(normalized.answer_sql, normalized.solution_sql);

  // Build sample_queries from AI response or fall back to answer_sql
  let sampleQueries: Array<{ title: string; sql: string; difficulty: string }> = [];
  if (Array.isArray(normalized.sample_queries) && normalized.sample_queries.length > 0) {
    sampleQueries = (normalized.sample_queries as any[]).map((q: any) => ({
      title: String(q.title ?? 'Answer'),
      sql: String(q.sql ?? ''),
      difficulty: String(q.difficulty ?? input.difficulty),
    }));
  } else if (answerSql) {
    sampleQueries = [{ title: 'Answer', sql: answerSql, difficulty: input.difficulty }];
  }

  return {
    title: coalesceString(normalized.problem_title, `${input.topic_tag} - SQL Query`),
    statement_md: statementMd,
    difficulty: String(raw.difficulty ?? input.difficulty),
    topic_tags: Array.isArray(normalized.topic_tags)
      ? (normalized.topic_tags as unknown[]).map((tag) => String(tag))
      : [input.topic_tag, 'SQL'],
    database_type: input.database_type ?? 'MySQL',
    database_schema: {
      ddl_sql: schemaBlock?.ddl_sql ? String(schemaBlock.ddl_sql) : undefined,
      tables: Array.isArray(schemaBlock?.tables) ? schemaBlock.tables : [],
    },
    seed_data: {
      random_seed: input.seed_options?.random_seed ?? 42,
      size: input.seed_options?.size ?? 'small',
      insert_sql: seedBlock?.insert_sql ? String(seedBlock.insert_sql) : undefined,
      row_counts: (seedBlock?.row_counts as Record<string, number>) ?? {},
      notes: seedBlock?.notes ? String(seedBlock.notes) : 'Example rows from the problem statement.',
    },
    sample_queries: sampleQueries,
    supported_query_patterns: [],
    hints: Array.isArray(normalized.hints)
      ? (normalized.hints as unknown[]).map((hint) => String(hint)).slice(0, 3)
      : undefined,
    quality_checklist_passed: normalized.quality_checklist_passed !== false,
    evaluationConfig: {
      database_setup: {
        ddl_sql: schemaBlock?.ddl_sql ? String(schemaBlock.ddl_sql) : undefined,
        insert_sql: seedBlock?.insert_sql ? String(seedBlock.insert_sql) : undefined,
      },
    },
  };
}
