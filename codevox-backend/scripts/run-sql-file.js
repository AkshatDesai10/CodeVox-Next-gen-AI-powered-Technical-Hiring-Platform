#!/usr/bin/env node
/**
 * Run a single SQL migration file against Recruitment MySQL.
 * Usage: node scripts/run-sql-file.js sql/migrations/000_cctv_auth_and_courses.sql
 *
 * Prefers RECRUITMENT_MYSQL_* (app standard); falls back to CCTV_MYSQL_* / VIVA_MYSQL_*.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function env(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/run-sql-file.js <sql-file>');
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  const sql = fs.readFileSync(abs, 'utf8');
  const host = env('RECRUITMENT_MYSQL_HOST', 'CCTV_MYSQL_HOST', 'VIVA_MYSQL_HOST');
  const user = env('RECRUITMENT_MYSQL_USER', 'CCTV_MYSQL_USER', 'VIVA_MYSQL_USER');
  const database = env(
    'RECRUITMENT_MYSQL_DATABASE',
    'CCTV_MYSQL_DATABASE',
    'VIVA_MYSQL_DATABASE',
  );
  if (!host || !user || !database) {
    console.error(
      'Missing MySQL config. Set RECRUITMENT_MYSQL_HOST, RECRUITMENT_MYSQL_USER, RECRUITMENT_MYSQL_DATABASE in .env',
    );
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host,
    port: Number(env('RECRUITMENT_MYSQL_PORT', 'CCTV_MYSQL_PORT', 'VIVA_MYSQL_PORT') || 3306),
    user,
    password: env(
      'RECRUITMENT_MYSQL_PASSWORD',
      'CCTV_MYSQL_PASSWORD',
      'VIVA_MYSQL_PASSWORD',
    ),
    database,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log('OK', path.basename(abs));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
