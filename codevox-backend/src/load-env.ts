import { setDefaultResultOrder } from 'dns';
import { config } from 'dotenv';
import { resolve } from 'path';

/** Load `.env` from the cctv-backend package root before AppModule / TypeORM read process.env. */
config({ path: resolve(process.cwd(), '.env') });

if (typeof setDefaultResultOrder === 'function') {
  setDefaultResultOrder('ipv4first');
}
