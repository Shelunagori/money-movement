import pg from 'pg';
import { config } from './config.js';
import {logger } from './logger.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  logger.error({ err: { message: err.message } }, 'idle database client error');
});
export {pool};

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}