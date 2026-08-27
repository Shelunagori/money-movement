import 'dotenv/config';

import { config } from './config.js';
import { pool } from './db.js';

async function main(): Promise<void> {
  await pool.query('SELECT 1 AS ok');

  console.log('database connection verified');
  console.log(`configured port: ${config.port}`);
}

main().catch((error) => {
  console.error('startup failed', error);
  process.exit(1);
});