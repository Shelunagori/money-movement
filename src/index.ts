import 'dotenv/config';

import { config } from './shared/config.js';
import { pool } from './shared/db.js';
import { buildServer } from './server.js';
import { logger } from './shared/logger.js';

async function main(): Promise<void> {
  await pool.query('SELECT 1 AS ok');
  const app = buildServer();   
  app.log.info('database connection verified');
  await app.listen({
    port : config.port,
  })  
  app.log.info('Server started');
}
main().catch((error) => {
  logger.error({ err: error }, 'startup failed');
  process.exit(1);
});