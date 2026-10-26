import { existsSync } from 'fs';
import { resolve } from 'path';
import { setDefaultResultOrder } from 'dns';
import { config } from 'dotenv';

/** Load `.env` from package root or current working directory before AppModule / TypeORM read process.env. */
const candidatePaths = [
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'codevox-backend/.env'),
];

for (const p of candidatePaths) {
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
}

if (typeof setDefaultResultOrder === 'function') {
  setDefaultResultOrder('ipv4first');
}
