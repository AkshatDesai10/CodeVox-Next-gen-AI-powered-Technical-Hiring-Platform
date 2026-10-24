/**
 * One-shot TypeORM synchronize for local empty DBs (entities → tables).
 * Usage: node scripts/sync-schema.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { DataSource } = require('typeorm');

const host = (process.env.RECRUITMENT_MYSQL_HOST || '127.0.0.1').trim();
const port = Number(process.env.RECRUITMENT_MYSQL_PORT || 3306);
const username = (process.env.RECRUITMENT_MYSQL_USER || '').trim();
const password = process.env.RECRUITMENT_MYSQL_PASSWORD || '';
const database = (process.env.RECRUITMENT_MYSQL_DATABASE || 'codevox').trim();

const entityGlob = path.join(root, 'src', '**', '*.entity.ts').replace(/\\/g, '/');

const ds = new DataSource({
  type: 'mysql',
  host,
  port,
  username,
  password,
  database,
  entities: [entityGlob],
  synchronize: true,
  logging: false,
});

await ds.initialize();
console.log(`Synchronized schema on ${database} (${ds.entityMetadatas.length} entities)`);
await ds.destroy();
