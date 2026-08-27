import Fastify from 'fastify';
import { pool } from './db.js';

export function buildServer() {
  const app = Fastify({
    logger: true,
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
  return app;
}