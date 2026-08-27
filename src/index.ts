import 'dotenv/config';

import { config } from './config.js';
import { pool } from './db.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  await pool.query('SELECT 1 AS ok');
  console.log('database connection verified');
  console.log(`configured port: ${config.port}`);
  const app = buildServer(); 
  await app.listen({
    port : config.port,
  })
  app.log.info('Server started');
}
main().catch((error) => {
  process.exit(1);
});