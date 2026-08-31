import Fastify from 'fastify';
import { pool } from './shared/db.js';
import { logger } from './shared/logger.js';
import { registerTransferRoutes } from './transfers/routes.js';
import { registerLedgerRoutes } from './ledger/routes.js';

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
  });

  // routes get registered here
  app.get('/health', async (request, result) => {
    try {
        await pool.query('SELECT 1');
        return {status : 'ok'};
    } catch (error) {
        request.log.warn({error}, 'database health check failed');
        return result.status(503).send({
            status : 'unavailable'
        })
    }
  });

  await registerTransferRoutes(app);
  await registerLedgerRoutes(app);

  return app;
}