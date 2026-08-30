import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../shared/db.js';
import { postLedgerTransaction, getBalance } from './ledger.js';

let accountA: string;   // INR
let accountB: string;   // INR
let accountUsd: string; // USD — mismatch test ke liye
let accountFees: string;
let accountBal: string; // INR — balance test ke liye

beforeAll(async () => {
  const suffix = Date.now();
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ($1, 'LIABILITY', 'INR'),
       ($2, 'LIABILITY', 'INR'),
       ($3, 'LIABILITY', 'USD'),
       ($4, 'LIABILITY', 'INR'),
       ($5, 'LIABILITY', 'INR')
     RETURNING id`,
    [`test_acc_a_${suffix}`, `test_acc_b_${suffix}`, `test_acc_usd_${suffix}`, `test_acc_fees_${suffix}`, `test_acc_bal_${suffix}`]
  );

  [accountA, accountB, accountUsd, accountFees, accountBal] =
    res.rows.map((r) => r.id);
});

describe('postLedgerTransaction', () => {
  it('posts a balanced two-entry transaction', async () => {
    const txId = await postLedgerTransaction({
      type: 'TEST_TRANSFER',
      entries: [
        { accountId: accountA, direction: 'DEBIT', amountMinor: 1000n },
        { accountId: accountB, direction: 'CREDIT', amountMinor: 1000n },
      ],
    });

    expect(txId).toBeDefined();

    const entries = await pool.query(
      `SELECT direction, amount
       FROM ledger_entries
       WHERE ledger_transaction_id = $1`,
      [txId]
    );

    expect(entries.rows).toHaveLength(2);
  });

  it('rejects an unbalanced transaction and persists nothing', async () => {
    await expect(
      postLedgerTransaction({
        type: 'TEST_UNBALANCED',
        entries: [
          { accountId: accountA, direction: 'DEBIT', amountMinor: 1000n },
          { accountId: accountB, direction: 'CREDIT', amountMinor: 900n },
        ],
      })
    ).rejects.toThrow('Unbalanced');

    const check = await pool.query(
      `SELECT *
       FROM ledger_transactions
       WHERE type = 'TEST_UNBALANCED'`
    );

    expect(check.rows).toHaveLength(0);
  });

  it('rejects a single-entry transaction', async () => {
    await expect(
      postLedgerTransaction({
        type: 'TEST_UNBALANCED',
        entries: [
          { accountId: accountA, direction: 'DEBIT', amountMinor: 1000n },
        ],
      })
    ).rejects.toThrow('at least two');

    const check = await pool.query(
      `SELECT *
       FROM ledger_transactions
       WHERE type = 'TEST_UNBALANCED'`
    );

    expect(check.rows).toHaveLength(0);
  });

  it('rejects mixed currencies and persists nothing', async () => {
    await expect(
      postLedgerTransaction({
        type: 'TEST_MISMATCH',
        entries: [
          { accountId: accountA, direction: 'DEBIT', amountMinor: 1000n },
          { accountId: accountUsd, direction: 'CREDIT', amountMinor: 1000n },
        ],
      })
    ).rejects.toThrow('Currency mismatch');

    const check = await pool.query(
      `SELECT *
       FROM ledger_transactions
       WHERE type = 'TEST_MISMATCH'`
    );

    expect(check.rows).toHaveLength(0);
  });

  it('posts a three-legged transaction with a fee split', async () => {
    const txId = await postLedgerTransaction({
      type: 'TEST_TRANSFER',
      entries: [
        { accountId: accountA, direction: 'DEBIT', amountMinor: 10000n },
        { accountId: accountB, direction: 'CREDIT', amountMinor: 9800n },
        { accountId: accountFees, direction: 'CREDIT', amountMinor: 200n },
      ],
    });

    expect(txId).toBeDefined();

    const entries = await pool.query(
      `SELECT direction, amount
       FROM ledger_entries
       WHERE ledger_transaction_id = $1`,
      [txId]
    );

    expect(entries.rows).toHaveLength(3);
  });

  it('ledger entries cannot be updated or deleted', async () => {
    const txId = await postLedgerTransaction({
      type: 'TEST_IMMUTABLE',
      entries: [
        { accountId: accountA, direction: 'DEBIT', amountMinor: 500n },
        { accountId: accountB, direction: 'CREDIT', amountMinor: 500n },
      ],
    });

    await expect(
      pool.query(
        `UPDATE ledger_entries
         SET amount = 999
         WHERE ledger_transaction_id = $1`,
        [txId]
      )
    ).rejects.toThrow('immutable');

    await expect(
      pool.query(
        `DELETE FROM ledger_entries
         WHERE ledger_transaction_id = $1`,
        [txId]
      )
    ).rejects.toThrow('immutable');
  });

  it('returns the current account balance', async () => {
    // accountUsd has no successfully-posted entries, so its balance is zero.
    expect(await getBalance(accountUsd)).toBe(0n);

    // CREDIT 5000 into accountBal.
    await postLedgerTransaction({
      type: 'TEST_BALANCE_IN',
      entries: [
        { accountId: accountA, direction: 'DEBIT', amountMinor: 5000n },
        { accountId: accountBal, direction: 'CREDIT', amountMinor: 5000n },
      ],
    });

    // DEBIT 2000 out of accountBal.
    await postLedgerTransaction({
      type: 'TEST_BALANCE_OUT',
      entries: [
        { accountId: accountBal, direction: 'DEBIT', amountMinor: 2000n },
        { accountId: accountA, direction: 'CREDIT', amountMinor: 2000n },
      ],
    });

    expect(await getBalance(accountBal)).toBe(3000n);
  });

  it('keeps total ledger debits and credits equal', async () => {
    const result = await pool.query(
      `SELECT
         COALESCE(
           SUM(amount) FILTER (WHERE direction = 'DEBIT'),
           0
         ) AS total_debits,
         COALESCE(
           SUM(amount) FILTER (WHERE direction = 'CREDIT'),
           0
         ) AS total_credits
       FROM ledger_entries`
    );

    const totalDebits = BigInt(result.rows[0].total_debits);
    const totalCredits = BigInt(result.rows[0].total_credits);

    expect(totalDebits).toBe(totalCredits);
  });
});

afterAll(async () => {
  // Accounts are left in the database since ledger_entries are immutable
  // and have foreign key constraints. They won't conflict because of unique suffixes.
});