import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from './db.js';
import { postLedgerTransaction } from './ledger.js';

let accountA: string;   // INR
let accountB: string;   // INR
let accountUsd: string; // USD — mismatch test ke liye
let accountFees: string;
beforeAll(async () => {
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ('test_acc_a', 'LIABILITY', 'INR'),
       ('test_acc_b', 'LIABILITY', 'INR'),
       ('test_acc_usd', 'LIABILITY', 'USD'),
       ('test_acc_fees', 'LIABILITY', 'INR')
     RETURNING id`
  );
  [accountA, accountB, accountUsd, accountFees] = res.rows.map((r) => r.id);
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
            `SELECT direction, amount FROM ledger_entries WHERE ledger_transaction_id = $1`,
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
            `SELECT * FROM ledger_transactions WHERE type = 'TEST_UNBALANCED'`
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
            `SELECT * FROM ledger_transactions WHERE type = 'TEST_UNBALANCED'`
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
            `SELECT * FROM ledger_transactions WHERE type = 'TEST_MISMATCH'`
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
            `SELECT direction, amount FROM ledger_entries WHERE ledger_transaction_id = $1`,
            [txId]
            );
            expect(entries.rows).toHaveLength(3);
        });
    });

afterAll(async () => {
  await pool.query(
    `DELETE FROM ledger_entries WHERE ledger_account_id IN
       (SELECT id FROM ledger_accounts WHERE name LIKE 'test_acc_%')`
  );
  await pool.query(`DELETE FROM ledger_transactions WHERE type LIKE 'TEST_%'`);
  await pool.query(`DELETE FROM ledger_accounts WHERE name LIKE 'test_acc_%'`);
  await pool.end();
});