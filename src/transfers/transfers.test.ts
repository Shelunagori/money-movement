import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { pool } from '../shared/db.js';
import { postLedgerTransaction } from '../ledger/ledger.js';
import { getBalance } from '../ledger/ledger.js';

let app: Awaited<ReturnType<typeof buildServer>>;

let accountA: string; // INR
let accountB: string; // INR
let accountUsd: string; // USD
let accountEmpty: string; // INR but with no balance

beforeAll(async () => {
  app = await buildServer();

  const suffix = Date.now();
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR'),
       ($2, 'LIABILITY', 'INR'),
       ($3, 'LIABILITY', 'USD'),
       ($4, 'LIABILITY', 'INR'),
       ($5, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_tr_a_${suffix}`, `test_tr_b_${suffix}`, `test_tr_usd_${suffix}`, `test_tr_empty_${suffix}`, `test_tr_sink_${suffix}`]
  );

  [accountA, accountB, accountUsd, accountEmpty] = res.rows.slice(0, 4).map((r) => r.id);
  const accountSink = res.rows[4].id;

  // Seed accountA with 10000 INR via balanced ledger deposit (sink account absorbs the debit)
  await postLedgerTransaction({
    type: 'TEST_TRANSFER_SEED',
    entries: [
      { accountId: accountA, direction: 'CREDIT', amountMinor: 10000n },
      { accountId: accountSink, direction: 'DEBIT', amountMinor: 10000n },
    ],
  });
});

describe('POST /transfers', () => {
  it('happy path: creates a transfer and updates balances', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 1000,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.transferId).toBeDefined();
    expect(body.ledgerTransactionId).toBeDefined();
    expect(body.status).toBe('COMPLETED');

    // Verify balances: A should have 9000, B should have 1000
    const balanceA = await getBalance(accountA);
    const balanceB = await getBalance(accountB);
    expect(balanceA).toBe(9000n);
    expect(balanceB).toBe(1000n);

    // Verify transfer row exists with status COMPLETED
    const transferCheck = await pool.query(
      `SELECT status FROM transfers WHERE id = $1`,
      [body.transferId]
    );
    expect(transferCheck.rows[0].status).toBe('COMPLETED');

    // Verify 2 ledger entries exist
    const entriesCheck = await pool.query(
      `SELECT direction, amount FROM ledger_entries
       WHERE ledger_transaction_id = $1
       ORDER BY direction`,
      [body.ledgerTransactionId]
    );
    expect(entriesCheck.rows).toHaveLength(2);
    expect(entriesCheck.rows[0].direction).toBe('CREDIT');
    expect(entriesCheck.rows[1].direction).toBe('DEBIT');
  });

  it('insufficient funds: returns 422 and does not create transfer/entries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountEmpty,
        toAccountId: accountB,
        amountMinor: 1,
      },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Insufficient funds');

    // Verify no transfer row was created
    const transferCheck = await pool.query(
      `SELECT COUNT(*) as cnt FROM transfers WHERE from_account_id = $1 AND to_account_id = $2 AND amount = $3`,
      [accountEmpty, accountB, '1']
    );
    expect(transferCheck.rows[0].cnt).toBe('0');

    // Verify balances unchanged
    const balanceEmpty = await getBalance(accountEmpty);
    const balanceB = await getBalance(accountB);
    expect(balanceEmpty).toBe(0n);
    expect(balanceB).toBe(1000n);
  });

  it('unknown account id (valid uuid): returns 404', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: fakeUuid,
        toAccountId: accountB,
        amountMinor: 100,
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Unknown');
  });

  it('same from/to account: rejected with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountA,
        amountMinor: 100,
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it('amountMinor: 0 → rejected by schema with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 0,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('amountMinor: negative → rejected by schema with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: -100,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('amountMinor: string → rejected by schema with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 'not-a-number',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('amountMinor: float 10.5 → rejected by schema with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 10.5,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('currency mismatch: returns 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountUsd,
        amountMinor: 100,
      },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Currency mismatch');
  });
});

describe('GET /transfers/:id', () => {
  it('returns the created transfer with correct fields', async () => {
    // Create a transfer first
    const createRes = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: {
        fromAccountId: accountA,
        toAccountId: accountB,
        amountMinor: 500,
      },
    });
    const createBody = JSON.parse(createRes.body);
    const transferId = createBody.transferId;

    // Get the transfer
    const res = await app.inject({
      method: 'GET',
      url: `/transfers/${transferId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(transferId);
    expect(body.fromAccountId).toBe(accountA);
    expect(body.toAccountId).toBe(accountB);
    expect(body.amount).toBe('500');
    expect(body.currency).toBe('INR');
    expect(body.status).toBe('COMPLETED');
    expect(body.ledgerTransactionId).toBe(createBody.ledgerTransactionId);
    expect(body.createdAt).toBeDefined();
  });

  it('random uuid returns 404', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'GET',
      url: `/transfers/${fakeUuid}`,
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('not found');
  });
});

afterAll(async () => {
  // Note: Transfers and ledger entries are left in the database.
  // They won't conflict because account names include unique suffixes (timestamps).
  await app.close();
});
