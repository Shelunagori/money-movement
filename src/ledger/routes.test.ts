import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import { pool } from '../shared/db.js';
import { postLedgerTransaction } from './ledger.js';

let app: Awaited<ReturnType<typeof buildServer>>;
let accountA: string;
let accountB: string;

beforeAll(async () => {
  app = await buildServer();

  const suffix = Date.now();
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR'),
       ($2, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_ledger_a_${suffix}`, `test_ledger_b_${suffix}`]
  );

  [accountA, accountB] = res.rows.map((r) => r.id);

  // Seed accountA with some transactions
  for (let i = 0; i < 3; i++) {
    await postLedgerTransaction({
      type: `TEST_LEDGER_SEED_${i}`,
      entries: [
        { accountId: accountA, direction: 'CREDIT', amountMinor: 1000n },
        { accountId: accountB, direction: 'DEBIT', amountMinor: 1000n },
      ],
    });
  }
});

describe('GET /accounts/:id/balance', () => {
  it('returns account balance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/balance`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accountId).toBe(accountA);
    expect(body.currency).toBe('INR');
    expect(body.balanceMinor).toBe('3000'); // 3 * 1000
  });

  it('returns 404 for unknown account', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/accounts/00000000-0000-0000-0000-000000000000/balance',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /accounts/:id/ledger', () => {
  it('returns entries in newest-first order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=10`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entries).toHaveLength(3);
    expect(body.nextCursor).toBeNull();

    // Verify newest-first
    expect(body.entries[0].createdAt >= body.entries[1].createdAt).toBe(true);
    expect(body.entries[1].createdAt >= body.entries[2].createdAt).toBe(true);
  });

  it('respects limit parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=2`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entries).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
  });

  it('caps limit at 100', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=200`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Only 3 entries total, so all returned even though limit capped at 100
    expect(body.entries).toHaveLength(3);
  });

  it('paginates with cursor', async () => {
    // First page
    const res1 = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=1`,
    });
    expect(res1.statusCode).toBe(200);
    const page1 = JSON.parse(res1.body);
    expect(page1.entries).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    // Second page
    const res2 = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=1&cursor=${page1.nextCursor}`,
    });
    expect(res2.statusCode).toBe(200);
    const page2 = JSON.parse(res2.body);
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries[0].id).not.toBe(page1.entries[0].id);

    // Third page
    const res3 = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=1&cursor=${page2.nextCursor}`,
    });
    expect(res3.statusCode).toBe(200);
    const page3 = JSON.parse(res3.body);
    expect(page3.entries).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it('returns amounts as strings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/accounts/${accountA}/ledger?limit=10`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.entries[0].amountMinor).toBe('string');
    expect(body.entries[0].amountMinor).toBe('1000');
  });

  it('returns 404 for unknown account', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/accounts/00000000-0000-0000-0000-000000000000/ledger',
    });

    expect(res.statusCode).toBe(404);
  });
});

afterAll(async () => {
  await app.close();
});
