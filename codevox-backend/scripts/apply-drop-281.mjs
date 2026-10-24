import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const c = await mysql.createConnection({
  host: process.env.RECRUITMENT_MYSQL_HOST,
  port: Number(process.env.RECRUITMENT_MYSQL_PORT || 3306),
  user: process.env.RECRUITMENT_MYSQL_USER,
  password: process.env.RECRUITMENT_MYSQL_PASSWORD,
  database: process.env.RECRUITMENT_MYSQL_DATABASE,
  multipleStatements: true,
});

const sql = fs.readFileSync(
  path.join(root, 'sql', 'migrations', '281_drop_removed_features.sql'),
  'utf8',
);
await c.query(sql);
await c.query(
  'INSERT IGNORE INTO _codevox_sql_migrations (filename) VALUES (?)',
  ['281_drop_removed_features.sql'],
);

for (const t of [
  'recruitment_interview_time_slots',
  'cost_rate_cards',
  'cost_fx_rates',
  'assessment_usage_ledger',
]) {
  const [r] = await c.query('SHOW TABLES LIKE ?', [t]);
  console.log(t, r.length ? 'STILL_EXISTS' : 'DROPPED');
}

const [cols] = await c.query(
  "SHOW COLUMNS FROM recruitment_lead_overlay LIKE 'invite_slot%'",
);
console.log(
  'invite_slot_cols',
  cols.map((x) => x.Field),
);
await c.end();
