/**
 * One-shot: create `codevox` DB on TiDB and apply local SQL bootstrap + migrations.
 * Usage (env already set): node scripts/tidb-bootstrap.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const host = process.env.RECRUITMENT_MYSQL_HOST;
const port = Number(process.env.RECRUITMENT_MYSQL_PORT || 4000);
const user = process.env.RECRUITMENT_MYSQL_USER;
const password = process.env.RECRUITMENT_MYSQL_PASSWORD;
const database = process.env.RECRUITMENT_MYSQL_DATABASE || 'codevox';

if (!host || !user || !password) {
  console.error('Missing RECRUITMENT_MYSQL_HOST/USER/PASSWORD');
  process.exit(1);
}

const ssl = {
  minVersion: 'TLSv1.2',
  rejectUnauthorized: true,
};

async function runFile(conn, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  try {
    await conn.query(sql);
  } catch (err) {
    // TiDB/MySQL: ignore "already exists" / duplicate for re-runs
    if (
      err &&
      (err.errno === 1050 ||
        err.errno === 1061 ||
        err.errno === 1062 ||
        err.code === 'ER_TABLE_EXISTS_ERROR' ||
        err.code === 'ER_DUP_ENTRY')
    ) {
      console.log('SKIP', path.relative(root, filePath), err.code || err.errno);
      return;
    }
    console.error(`Failed in ${path.basename(filePath)}:`, err.message);
    throw err;
  }
  console.log('OK', path.relative(root, filePath));
}

async function main() {
  const admin = await mysql.createConnection({
    host,
    port,
    user,
    password,
    ssl,
    multipleStatements: true,
  });
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  console.log('Database ready:', database);
  await admin.end();

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    ssl,
    multipleStatements: true,
  });

  // 001 = RBAC seed. Skip 002_* (assumes tables already exist from local sync).
  // Entity tables are created at app boot when TYPEORM_SYNC=true.
  const bootstrap = path.join(root, 'sql', 'local', '001_rbac_bootstrap.sql');
  await runFile(conn, bootstrap);

  await conn.end();
  console.log('Bootstrap complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
