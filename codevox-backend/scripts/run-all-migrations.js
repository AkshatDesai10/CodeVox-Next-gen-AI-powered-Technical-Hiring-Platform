#!/usr/bin/env node
/**
 * Run all sql/migrations/*.sql in filename order against CCTV MySQL.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.resolve(process.cwd(), 'sql/migrations');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

for (const f of files) {
  const rel = path.join('sql/migrations', f);
  console.log('→', rel);
  const r = spawnSync(
    process.execPath,
    [path.join('scripts', 'run-sql-file.js'), rel],
    { stdio: 'inherit', cwd: process.cwd() },
  );
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log('All migrations applied.');
