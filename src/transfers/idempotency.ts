import { createHash } from 'node:crypto';
import pg from 'pg';
import { pool } from '../shared/db.js';

export function hashRequestBody(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export interface IdempotencyKeyRow {
  key: string;
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_status: number | null;
  response_body: unknown;
  created_at: string;
}

export async function claimKey(
  key: string,
  requestHash: string
): Promise<'claimed' | IdempotencyKeyRow> {
  const result = await pool.query(
    `INSERT INTO idempotency_keys (key, request_hash, status)
     VALUES ($1, $2, 'IN_PROGRESS')
     ON CONFLICT (key) DO NOTHING
     RETURNING *`,
    [key, requestHash]
  );

  if (result.rows.length > 0) {
    return 'claimed';
  }

  // Key already exists, fetch the existing row
  const existingResult = await pool.query(
    `SELECT * FROM idempotency_keys WHERE key = $1`,
    [key]
  );

  return existingResult.rows[0] as IdempotencyKeyRow;
}

export async function completeKey(
  client: pg.PoolClient,
  key: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET status = 'COMPLETED', response_status = $2, response_body = $3
     WHERE key = $1`,
    [key, responseStatus, JSON.stringify(responseBody)]
  );
}
