import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const host = (process.env.RECRUITMENT_MYSQL_HOST || '127.0.0.1').trim();
const port = Number(process.env.RECRUITMENT_MYSQL_PORT || 3306);
const user = (process.env.RECRUITMENT_MYSQL_USER || '').trim();
const password = process.env.RECRUITMENT_MYSQL_PASSWORD || '';
const database = (process.env.RECRUITMENT_MYSQL_DATABASE || 'codevox').trim();

const c = await mysql.createConnection({ host, port, user, password });
await c.query(
  `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
const [dbs] = await c.query('SHOW DATABASES LIKE ?', [database]);
console.log('databases', dbs);
await c.changeUser({ database });
const [tables] = await c.query('SHOW TABLES');
console.log('tableCount', tables.length);
await c.end();
