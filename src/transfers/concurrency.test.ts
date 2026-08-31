import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { pool } from '../shared/db.js';
import { postLedgerTransaction, getBalance } from '../ledger/ledger.js';

let app: Awaited<ReturnType<typeof buildServer>>;

let senderA: string; // for tests a, b
let receiverB: string;
let senderC: string; // for test c
let senderD: string; // for test c

beforeAll(async () => {
  app = await buildServer();

  const suffix = Date.now();
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR'),
       ($2, 'LIABILITY', 'INR'),
       ($3, 'LIABILITY', 'INR'),
       ($4, 'LIABILITY', 'INR')
     RETURNING id`,
    [
      `test_conc_sendA_${suffix}`,
      `test_conc_recvB_${suffix}`,
      `test_conc_sendC_${suffix}`,
      `test_conc_sendD_${suffix}`,
    ]
  );

  [senderA, receiverB, senderC, senderD] = res.rows.map((r) => r.id);

  // Seed senderA with 10000 INR
  const sinkResA = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_conc_sink_a_${suffix}`]
  );
  const sinkA = sinkResA.rows[0].id;

  await postLedgerTransaction({
    type: 'TEST_CONC_SEED',
    entries: [
      { accountId: senderA, direction: 'CREDIT', amountMinor: 10000n },
      { accountId: sinkA, direction: 'DEBIT', amountMinor: 10000n },
    ],
  });

  // Seed senderC with 5000 INR
  const sinkResC = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_conc_sink_c_${suffix}`]
  );
  const sinkC = sinkResC.rows[0].id;

  await postLedgerTransaction({
    type: 'TEST_CONC_SEED',
    entries: [
      { accountId: senderC, direction: 'CREDIT', amountMinor: 5000n },
      { accountId: sinkC, direction: 'DEBIT', amountMinor: 5000n },
    ],
  });

  // Seed senderD with 5000 INR
  const sinkResD = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_conc_sink_d_${suffix}`]
  );
  const sinkD = sinkResD.rows[0].id;

  await postLedgerTransaction({
    type: 'TEST_CONC_SEED',
    entries: [
      { accountId: senderD, direction: 'CREDIT', amountMinor: 5000n },
      { accountId: sinkD, direction: 'DEBIT', amountMinor: 5000n },
    ],
  });
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM idempotency_keys WHERE key LIKE 'test-idem-conc-%'`
  );
});

describe('Concurrency-safe transfers', () => {
  it('prevents double spend under concurrent transfers', async () => {
    const key1 = 'test-idem-conc-double-1-' + Date.now();
    const key2 = 'test-idem-conc-double-2-' + Date.now();

    const payload1 = {
      fromAccountId: senderA,
      toAccountId: receiverB,
      amountMinor: 8000,
    };

    const payload2 = {
      fromAccountId: senderA,
      toAccountId: receiverB,
      amountMinor: 8000,
    };

    // Fire both in parallel with different keys
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/transfers',
        headers: { 'idempotency-key': key1 },
        payload: payload1,
      }),
      app.inject({
        method: 'POST',
        url: '/transfers',
        headers: { 'idempotency-key': key2 },
        payload: payload2,
      }),
    ]);

    // One should succeed (201), one should fail with insufficient funds (422)
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([201, 422]);

    // Sender balance should be exactly 2000 (10000 - 8000)
    const balance = await getBalance(senderA);
    expect(balance).toBe(2000n);

    // Exactly one transfer row exists for this sender in this test
    const transferRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM transfers WHERE from_account_id = $1`,
      [senderA]
    );
    expect(Number(transferRes.rows[0].cnt)).toBe(1);
  });

  it('overspend impossible under 10 parallel transfers', async () => {
    // Create a fresh sender with 10000
    const suffix = Date.now();
    const freshRes = await pool.query(
      `INSERT INTO ledger_accounts (name, type, currency) VALUES
         ($1, 'LIABILITY', 'INR')
       RETURNING id`,
      [`test_conc_fresh_${suffix}`]
    );
    const freshSender = freshRes.rows[0].id;

    const sinkRes = await pool.query(
      `INSERT INTO ledger_accounts (name, type, currency) VALUES
         ($1, 'LIABILITY', 'INR')
       RETURNING id`,
      [`test_conc_fresh_sink_${suffix}`]
    );
    const freshSink = sinkRes.rows[0].id;

    await postLedgerTransaction({
      type: 'TEST_CONC_SEED',
      entries: [
        { accountId: freshSender, direction: 'CREDIT', amountMinor: 10000n },
        { accountId: freshSink, direction: 'DEBIT', amountMinor: 10000n },
      ],
    });

    // Create 10 parallel transfer requests of 3000 each (total 30000, but only 10000 available)
    const requests = [];
    for (let i = 0; i < 10; i++) {
      const key = `test-idem-conc-overspend-${i}-${Date.now()}`;
      requests.push(
        app.inject({
          method: 'POST',
          url: '/transfers',
          headers: { 'idempotency-key': key },
          payload: {
            fromAccountId: freshSender,
            toAccountId: receiverB,
            amountMinor: 3000,
          },
        })
      );
    }

    const results = await Promise.all(requests);
    const statuses = results.map((r) => r.statusCode);

    // Count 201s and 422s
    const count201 = statuses.filter((s) => s === 201).length;
    const count422 = statuses.filter((s) => s === 422).length;

    expect(count201).toBe(3); // 10000 / 3000 = 3 full transfers (9000), 1000 remainder
    expect(count422).toBe(7);

    // Sender balance should be exactly 1000 (10000 - 3*3000)
    const balance = await getBalance(freshSender);
    expect(balance).toBe(1000n);

    // Verify ledger global invariant: debits == credits
    const invariantRes = await pool.query(
      `SELECT
         SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END) as debits,
         SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END) as credits
       FROM ledger_entries`
    );
    const { debits, credits } = invariantRes.rows[0];
    expect(BigInt(debits)).toBe(BigInt(credits));
  });

  it('opposite-direction transfers do not deadlock', async () => {
    const key1 = 'test-idem-conc-opposite-1-' + Date.now();
    const key2 = 'test-idem-conc-opposite-2-' + Date.now();

    // Fire A→D and D→A in parallel (1000 each)
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/transfers',
        headers: { 'idempotency-key': key1 },
        payload: {
          fromAccountId: senderC,
          toAccountId: senderD,
          amountMinor: 1000,
        },
      }),
      app.inject({
        method: 'POST',
        url: '/transfers',
        headers: { 'idempotency-key': key2 },
        payload: {
          fromAccountId: senderD,
          toAccountId: senderC,
          amountMinor: 1000,
        },
      }),
    ]);

    // Both should succeed
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    // Both balances should remain unchanged (5000 each)
    const balanceC = await getBalance(senderC);
    const balanceD = await getBalance(senderD);
    expect(balanceC).toBe(5000n);
    expect(balanceD).toBe(5000n);
  });
});
