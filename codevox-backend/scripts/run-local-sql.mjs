import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const conn = await mysql.createConnection({
  host: process.env.RECRUITMENT_MYSQL_HOST,
  port: Number(process.env.RECRUITMENT_MYSQL_PORT || 3306),
  user: process.env.RECRUITMENT_MYSQL_USER,
  password: process.env.RECRUITMENT_MYSQL_PASSWORD,
  database: process.env.RECRUITMENT_MYSQL_DATABASE,
  multipleStatements: true,
});

const dir = path.join(root, 'sql', 'local');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  process.stdout.write(`→ ${file} ... `);
  await conn.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  console.log('OK');
}

const [tables] = await conn.query('SHOW TABLES');
const [users] = await conn.query('SHOW COLUMNS FROM users');
const [roles] = await conn.query('SELECT id, `key` FROM roles');
console.log(`tables=${tables.length} usersColumns=${users.length} roles=`, roles);
await conn.end();
