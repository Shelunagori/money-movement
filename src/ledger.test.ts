import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from './db.js';
import { postLedgerTransaction } from './ledger.js';

let accountA: string;   // INR
let accountB: string;   // INR
let accountUsd: string; // USD — mismatch test ke liye

beforeAll(async () => {
  const res = await pool.query(
    `INSERT INTO ledger_accounts (name, type, currency) VALUES
       ('test_acc_a', 'LIABILITY', 'INR'),
       ('test_acc_b', 'LIABILITY', 'INR'),
       ('test_acc_usd', 'LIABILITY', 'USD')
     RETURNING id`
  );
  [accountA, accountB, accountUsd] = res.rows.map((r) => r.id);
});