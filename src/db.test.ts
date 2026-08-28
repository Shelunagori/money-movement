import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTransaction } from './db.js';

describe('withTransaction', () => {
  it('rolls back everything when the callback throws', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query(
          `INSERT INTO ledger_transactions (type, description) VALUES ('TEST_ROLLBACK', 'should not survive')`
        );
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const check = await pool.query(
      `SELECT * FROM ledger_transactions WHERE type = 'TEST_ROLLBACK'`
    );
    expect(check.rows).toHaveLength(0);
  });

it('commits and returns the callback result', async () => {
  const txId = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ledger_transactions (type, description)
       VALUES ('TEST_COMMIT', 'should survive') RETURNING id`
    );
    return res.rows[0].id;
  });

    expect(txId).toBeDefined();
    const check = await pool.query(`SELECT * FROM ledger_transactions WHERE id = $1`, [txId]);
    expect(check.rows[0].id).toBe(txId);
    expect(check.rows).toHaveLength(1);
});

});

afterAll(async () => {
  await pool.query(`DELETE FROM ledger_transactions WHERE type IN ('TEST_ROLLBACK', 'TEST_COMMIT')`);
  await pool.end();
});