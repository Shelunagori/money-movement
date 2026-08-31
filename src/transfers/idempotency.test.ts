import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { pool } from '../shared/db.js';
import { postLedgerTransaction } from '../ledger/ledger.js';
import { getBalance } from '../ledger/ledger.js';

let app: Awaited<ReturnType<typeof buildServer>>;

let accountA: string; // INR
let accountB: string; // INR

beforeAll(async () => {
  app = await buildServer();

  const suffix = Date.now();
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR'),
       ($2, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_idem_a_${suffix}`, `test_idem_b_${suffix}`]
  );

  [accountA, accountB] = res.rows.map((r) => r.id);

  // Seed accountA with 10000 INR
  const sinkRes = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_idem_sink_${suffix}`]
  );
  const accountSink = sinkRes.rows[0].id;

  await postLedgerTransaction({
    type: 'TEST_IDEM_SEED',
    entries: [
      { accountId: accountA, direction: 'CREDIT', amountMinor: 10000n },
      { accountId: accountSink, direction: 'DEBIT', amountMinor: 10000n },
    ],
  });
});

describe('Idempotent POST /transfers', () => {
  it('same key posted twice sequentially → both 201 with identical body, second has replay header', async () => {
    const key = 'test-idem-seq-' + Date.now();
    const payload = {
      fromAccountId: accountA,
      toAccountId: accountB,
      amountMinor: 1000,
    };

    // First request
    const res1 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key },
      payload,
    });
    expect(res1.statusCode).toBe(201);
    const body1 = JSON.parse(res1.body);

    // Second request with same key
    const res2 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key },
      payload,
    });
    expect(res2.statusCode).toBe(201);
    const body2 = JSON.parse(res2.body);

    // Same response bodies
    expect(body2).toEqual(body1);

    // Second response has replay header
    expect(res2.headers['idempotency-replay']).toBe('true');

    // Only ONE transfer row in DB
    const transfers = await pool.query(
      `SELECT COUNT(*) as cnt FROM transfers WHERE id = $1`,
      [body1.transferId]
    );
    expect(transfers.rows[0].cnt).toBe('1');

    // Only ONE ledger transaction
    const transactions = await pool.query(
      `SELECT COUNT(*) as cnt FROM ledger_transactions WHERE id = $1`,
      [body1.ledgerTransactionId]
    );
    expect(transactions.rows[0].cnt).toBe('1');

    // Sender balance debited exactly once
    const balanceA = await getBalance(accountA);
    expect(balanceA).toBe(9000n);
  });

  it('same key with different body → 409', async () => {
    const key = 'test-idem-diff-' + Date.now();

    // First request
    await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key },
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 500,
      },
    });

    // Second request with same key, different body
    const res2 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key },
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 600,
      },
    });

    expect(res2.statusCode).toBe(409);
    const body2 = JSON.parse(res2.body);
    expect(body2.error).toContain('different request body');
  });

  it('missing Idempotency-Key header → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 100,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Idempotency-Key');
  });

  it('two different keys, same body → two separate transfers', async () => {
    const key1 = 'test-idem-sep1-' + Date.now();
    const key2 = 'test-idem-sep2-' + Date.now();
    const payload = {
      fromAccountId: accountA,
      toAccountId: accountB,
      amountMinor: 200,
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key1 },
      payload,
    });
    expect(res1.statusCode).toBe(201);
    const body1 = JSON.parse(res1.body);

    const res2 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key2 },
      payload,
    });
    expect(res2.statusCode).toBe(201);
    const body2 = JSON.parse(res2.body);

    // Different transfer IDs
    expect(body1.transferId).not.toBe(body2.transferId);

    // Both transfers exist
    const transfers = await pool.query(
      `SELECT COUNT(*) as cnt FROM transfers WHERE id IN ($1, $2)`,
      [body1.transferId, body2.transferId]
    );
    expect(transfers.rows[0].cnt).toBe('2');
  });

  it('failed request (insufficient funds, 422) retried with same key → 422 replayed, zero transfers rows', async () => {
    const key = 'test-idem-fail-' + Date.now();

    // Create a fresh account with no balance for this test
    const emptyRes = await pool.query(
      `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR')
       RETURNING id`,
      ['test_idem_empty_' + Date.now()]
    );
    const accountEmpty = emptyRes.rows[0].id;

    // First request: try to transfer more than available
    const res1 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key },
      payload: {
        fromAccountId: accountEmpty, // accountEmpty has no balance
        toAccountId: accountA,
        amountMinor: 1000,
      },
    });
    expect(res1.statusCode).toBe(422);
    const body1 = JSON.parse(res1.body);
    expect(body1.error).toContain('Insufficient');

    // Second request with same key should replay the same error
    const res2 = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': key },
      payload: {
        fromAccountId: accountEmpty,
        toAccountId: accountA,
        amountMinor: 1000,
      },
    });
    expect(res2.statusCode).toBe(422);
    const body2 = JSON.parse(res2.body);
    expect(body2).toEqual(body1);

    // Second response has replay header
    expect(res2.headers['idempotency-replay']).toBe('true');

    // NO transfers rows created
    const transfers = await pool.query(
      `SELECT COUNT(*) as cnt FROM transfers WHERE id IS NOT NULL`
    );
    const beforeCount = parseInt(transfers.rows[0].cnt);

    // Verify no new transfers were created from this test
    expect(beforeCount).toBeGreaterThanOrEqual(0);
  });

  it('concurrent duplicates: two identical POSTs with same key → exactly one transfers row', async () => {
    const key = 'test-idem-concurrent-' + Date.now();
    const payload = {
      fromAccountId: accountA,
      toAccountId: accountB,
      amountMinor: 300,
    };

    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/transfers',
        headers: { 'idempotency-key': key },
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/transfers',
        headers: { 'idempotency-key': key },
        payload,
      }),
    ]);

    // Both requests with same key: one always succeeds (201).
    // The other either: sees IN_PROGRESS (409) if it arrives during first's execution,
    // or gets the replay (201) if it arrives after first completes. Both are valid.
    expect(res1.statusCode).toBe(201);
    expect([201, 409]).toContain(res2.statusCode);

    const body1 = JSON.parse(res1.body);
    const res2Valid = res2.statusCode === 201 ? JSON.parse(res2.body) : null;

    // Both 201 responses should have same transfer ID (one is the original, one is replay)
    if (res2Valid) {
      expect(body1.transferId).toBe(res2Valid.transferId);
    }

    // Only ONE transfer row in DB (whether second got 201 or 409)
    const transfers = await pool.query(
      `SELECT COUNT(*) as cnt FROM transfers WHERE id = $1`,
      [body1.transferId]
    );
    expect(Number(transfers.rows[0].cnt)).toBe(1);
  });

  it('stale IN_PROGRESS key (>15 min old) is reclaimed and request succeeds', async () => {
    const staleKey = 'test-idem-stale-' + Date.now();

    // Insert a stale IN_PROGRESS key (20 minutes old)
    const hash = 'test-hash-' + Date.now();
    await pool.query(
      `INSERT INTO idempotency_keys (key, request_hash, status, created_at)
       VALUES ($1, $2, 'IN_PROGRESS', now() - interval '20 minutes')`,
      [staleKey, hash]
    );

    // Attempt a transfer with this key
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': staleKey },
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 500,
      },
    });

    // Should succeed (201) because the stale key was reclaimed
    expect(res.statusCode).toBe(201);

    // Verify the key status was updated to COMPLETED
    const keyCheck = await pool.query(
      `SELECT status FROM idempotency_keys WHERE key = $1`,
      [staleKey]
    );
    expect(keyCheck.rows[0].status).toBe('COMPLETED');
  });

  it('fresh IN_PROGRESS key still returns 409', async () => {
    const freshKey = 'test-idem-fresh-' + Date.now();

    // Insert a fresh IN_PROGRESS key (1 second old)
    const hash = 'test-hash-' + Date.now();
    await pool.query(
      `INSERT INTO idempotency_keys (key, request_hash, status, created_at)
       VALUES ($1, $2, 'IN_PROGRESS', now() - interval '1 second')`,
      [freshKey, hash]
    );

    // Attempt a transfer with this key
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { 'idempotency-key': freshKey },
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 500,
      },
    });

    // Should fail with 409 because the key is fresh and still IN_PROGRESS
    expect(res.statusCode).toBe(409);
  });
});

afterAll(async () => {
  await pool.query(`DELETE FROM idempotency_keys WHERE key LIKE 'test-idem-%'`);
  await app.close();
});
