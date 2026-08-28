import pg from 'pg';
import { config } from './config.js';
import {logger } from './logger.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  logger.error({ err: { message: err.message } }, 'idle database client error');
});

export {pool};