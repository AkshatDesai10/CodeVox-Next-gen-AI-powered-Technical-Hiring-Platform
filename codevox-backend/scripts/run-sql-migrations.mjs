/**
 * Apply sql/migrations/*.sql in filename order against RECRUITMENT_MYSQL_*.
 * Tracks applied files in `_codevox_sql_migrations`.
 *
 * Usage: node scripts/run-sql-migrations.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

const host = (process.env.RECRUITMENT_MYSQL_HOST || '127.0.0.1').trim();
const port = Number(process.env.RECRUITMENT_MYSQL_PORT || 3306);
const user = (process.env.RECRUITMENT_MYSQL_USER || '').trim();
const password = process.env.RECRUITMENT_MYSQL_PASSWORD || '';
const database = (process.env.RECRUITMENT_MYSQL_DATABASE || 'codevox').trim();

if (!user || !database) {
  console.error('RECRUITMENT_MYSQL_USER and RECRUITMENT_MYSQL_DATABASE are required');
  process.exit(1);
}

const migrationsDir = path.join(root, 'sql', 'migrations');

async function main() {
  const admin = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
  });

  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await admin.end();

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS _codevox_sql_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [appliedRows] = await conn.query(
    'SELECT filename FROM _codevox_sql_migrations ORDER BY filename',
  );
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let ran = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    if (applied.has(file)) {
      skipped += 1;
      continue;
    }
    const full = path.join(migrationsDir, file);
    const sql = fs.readFileSync(full, 'utf8');
    process.stdout.write(`→ ${file} ... `);
    try {
      await conn.query(sql);
      await conn.query('INSERT INTO _codevox_sql_migrations (filename) VALUES (?)', [file]);
      console.log('OK');
      ran += 1;
    } catch (err) {
      failed += 1;
      console.log('FAIL');
      console.error(`  ${err.code || ''} ${err.message}`);
      // Continue: many older migrations assume a full shared schema that may be missing locally.
    }
  }

  await conn.end();
  console.log(`\nDone. applied=${ran} skipped=${skipped} failed=${failed} total=${files.length}`);
  if (failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
