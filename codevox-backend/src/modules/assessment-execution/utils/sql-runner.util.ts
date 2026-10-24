export const SQL_RUNNER_PY = `import sqlite3
from pathlib import Path

def main() -> None:
    sql_path = Path("/workspace/query.sql")
    sql = sql_path.read_text(encoding="utf-8").strip()
    if not sql:
        return

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    statements = [part.strip() for part in sql.split(";") if part.strip()]
    if not statements:
        return

    try:
        for statement in statements[:-1]:
            conn.execute(statement)

        last = statements[-1]
        cursor = conn.execute(last)
        if cursor.description:
            columns = [col[0] for col in cursor.description]
            print("\\t".join(columns))
            for row in cursor.fetchall():
                print("\\t".join(str(row[col]) for col in columns))
        conn.commit()
    finally:
        conn.close()

if __name__ == "__main__":
    main()
`;

/** Sample in-memory schema for local SQL practice (second-highest salary style questions). */
export const DEFAULT_SQL_SETUP = `CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL,
  salary INTEGER NOT NULL
);
INSERT INTO employees (id, name, dept, salary) VALUES
  (1, 'Alice', 'Eng', 9000),
  (2, 'Bob', 'Eng', 8500),
  (3, 'Carol', 'Eng', 8500),
  (4, 'Dave', 'Sales', 7000),
  (5, 'Eve', 'Sales', 6500)`;

/** True when text is executable SQL setup, not a schema hint like employees(dept,salary). */
export function isExecutableSqlSetup(value?: string | null): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*$/.test(trimmed)) {
    return false;
  }
  return /^(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|WITH|PRAGMA|BEGIN|COMMIT|--|\/\*)/i.test(
    trimmed,
  );
}

export function resolveSqlSetup(setupSql?: string | null): string | undefined {
  if (!isExecutableSqlSetup(setupSql)) return undefined;
  return setupSql!.trim();
}

export function resolveSqlSetupFromConfig(
  environmentConfig?: Record<string, unknown> | null,
): string | undefined {
  if (!environmentConfig) return undefined;
  const seedData = environmentConfig.seedData as { sql?: string[] } | undefined;
  if (!seedData?.sql?.length) return undefined;
  return seedData.sql.join(';\n');
}

export function buildSqlScript(sourceCode: string, setupSql?: string) {
  const query = sourceCode.trim();
  const setup = resolveSqlSetup(setupSql);
  if (setup && query) {
    return setup.endsWith(';') ? `${setup}\n${query}` : `${setup};\n${query}`;
  }
  return query || setup || '';
}

export const SUPPORTED_EXECUTION_LANGUAGES = ['PHP', 'PYTHON', 'NODE', 'SQL'] as const;
