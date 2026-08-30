import pg from 'pg';
import { withTransaction, pool } from '../shared/db.js';

interface EntryInput {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: bigint;
}

interface PostTransactionInput {
  type: string;
  description?: string;
  entries: EntryInput[];
}

export async function postLedgerTransactionOnClient(
  client: pg.PoolClient,
  input: PostTransactionInput
): Promise<string> {
  // Guard 1: Double-entry bookkeeping requires at least 2 entries
  if (input.entries.length < 2) {
    throw new Error('Ledger transaction must contain at least two entries');
  }

  // Guard 2: Debits must equal credits
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const entry of input.entries) {
    if (entry.direction === 'DEBIT') {
      debitTotal += entry.amountMinor;
    } else {
      creditTotal += entry.amountMinor;
    }
  }

  if (debitTotal !== creditTotal) {
    throw new Error(
      `Unbalanced ledger transaction: debits=${debitTotal}, credits=${creditTotal}`
    );
  }

  const accountIds = [
    ...new Set(input.entries.map((entry) => entry.accountId)),
  ];

  // Validate that every account exists and fetch currencies
  const accounts = await client.query(
    `SELECT id, currency
     FROM ledger_accounts
     WHERE id = ANY($1)`,
    [accountIds]
  );

  if (accounts.rows.length !== accountIds.length) {
    throw new Error(
      `Unknown ledger account: expected ${accountIds.length} accounts, found ${accounts.rows.length}`
    );
  }

  // All accounts in one transaction must use the same currency
  const currencies = new Set(
    accounts.rows.map((row) => row.currency)
  );

  if (currencies.size > 1) {
    throw new Error(
      `Currency mismatch across accounts: ${[...currencies].join(', ')}`
    );
  }

  // Create transaction header
  const transactionResult = await client.query(
    `INSERT INTO ledger_transactions (
       type,
       description
     )
     VALUES ($1, $2)
     RETURNING id`,
    [input.type, input.description ?? null]
  );

  const transactionId = transactionResult.rows[0].id as string;

  // Create ledger entries
  for (const entry of input.entries) {
    await client.query(
      `INSERT INTO ledger_entries (
         ledger_transaction_id,
         ledger_account_id,
         direction,
         amount
       )
       VALUES ($1, $2, $3, $4)`,
      [
        transactionId,
        entry.accountId,
        entry.direction,
        String(entry.amountMinor),
      ]
    );
  }

  return transactionId;
}

export async function postLedgerTransaction(
  input: PostTransactionInput
): Promise<string> {
  return withTransaction((client) => postLedgerTransactionOnClient(client, input));
}


export async function getBalance(accountId: string): Promise<bigint> {
  const result = await pool.query(
    `
        SELECT COALESCE(
        SUM(
            CASE
            WHEN direction = 'CREDIT' THEN amount
            ELSE -amount
            END
        ),
        0
        ) AS balance
        FROM ledger_entries
        WHERE ledger_account_id = $1
    `,
    [accountId]
  );

  // Balance convention: CREDIT - DEBIT.
  // For LIABILITY accounts (e.g. user wallets), this represents
  // the amount owed to / owned by the user. ASSET accounts read inversely.
  return BigInt(result.rows[0].balance);
}