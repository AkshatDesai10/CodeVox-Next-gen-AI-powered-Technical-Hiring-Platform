/** Coerce AI environment payloads into the shape expected by assessment execution. */
export function normalizeAiEnvironment(
  raw?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;

  const env: Record<string, unknown> = { ...raw };
  const schemaSql = resolveSchemaSqlFromEnvironment(env);
  if (schemaSql) {
    env.schemaSql = schemaSql;
  }

  if (schemaSql || env.dbName || env.dbHost) {
    env.dbName ??= 'testdb';
    env.dbHost ??= '127.0.0.1';
    env.dbUser ??= 'root';
    if (env.dbPassword === undefined) env.dbPassword = '';
  }

  return env;
}

export function resolveSchemaSqlFromEnvironment(
  env: Record<string, unknown>,
): string | null {
  for (const key of ['schemaSql', 'schema'] as const) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  const seedData = env.seedData;
  if (typeof seedData === 'string' && seedData.trim()) return seedData.trim();

  if (seedData && typeof seedData === 'object' && !Array.isArray(seedData)) {
    const sql = (seedData as { sql?: unknown }).sql;
    if (Array.isArray(sql)) {
      const statements = sql
        .map((stmt) => (typeof stmt === 'string' ? stmt.trim() : ''))
        .filter(Boolean);
      if (statements.length) return statements.join(';\n');
    }
  }

  return null;
}
