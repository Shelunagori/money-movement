import pg from 'pg';
import { withTransaction, pool } from '../shared/db.js';
import { postLedgerTransactionOnClient } from '../ledger/ledger.js';

export class AccountNotFoundError extends Error {
  name = 'AccountNotFoundError';
}

export class CurrencyMismatchError extends Error {
  name = 'CurrencyMismatchError';
}

export class InsufficientFundsError extends Error {
  name = 'InsufficientFundsError';
}

interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: bigint;
}

interface CreateTransferResult {
  transferId: string;
  ledgerTransactionId: string;
}

export async function createTransferOnClient(
  client: pg.PoolClient,
  input: CreateTransferInput
): Promise<CreateTransferResult> {
  // Load both accounts' currency and lock them (Phase 6: pessimistic locking)
  const accountsResult = await client.query(
    `SELECT id, currency FROM ledger_accounts WHERE id = ANY($1)
     ORDER BY id FOR UPDATE`,
    [[input.fromAccountId, input.toAccountId]]
  );

  const accounts = new Map(
    accountsResult.rows.map((row) => [row.id, row.currency])
  );

  // Unknown account check
  if (!accounts.has(input.fromAccountId) || !accounts.has(input.toAccountId)) {
    throw new AccountNotFoundError('Unknown ledger account');
  }

  // Different currencies check
  const fromCurrency = accounts.get(input.fromAccountId);
  const toCurrency = accounts.get(input.toAccountId);
  if (fromCurrency !== toCurrency) {
    throw new CurrencyMismatchError(
      `Currency mismatch across accounts: ${fromCurrency}, ${toCurrency}`
    );
  }

  // Compute from-account balance on the same client
  // Account rows are locked in sorted order above (FOR UPDATE), so this read
  // is serialized per account: concurrent transfers on the same account cannot
  // both pass the balance check. See ADR-006 for pessimistic locking design.
  const balanceResult = await client.query(
    `SELECT COALESCE(
      SUM(
        CASE
        WHEN direction = 'CREDIT' THEN amount
        ELSE -amount
        END
      ),
      0
    ) AS balance
    FROM ledger_entries
    WHERE ledger_account_id = $1`,
    [input.fromAccountId]
  );

  const balance = BigInt(balanceResult.rows[0].balance);
  if (balance < input.amountMinor) {
    throw new InsufficientFundsError('Insufficient funds');
  }

  // Post ledger transaction with 2 entries
  const ledgerTransactionId = await postLedgerTransactionOnClient(client, {
    type: 'INTERNAL_TRANSFER',
    entries: [
      {
        accountId: input.fromAccountId,
        direction: 'DEBIT',
        amountMinor: input.amountMinor,
      },
      {
        accountId: input.toAccountId,
        direction: 'CREDIT',
        amountMinor: input.amountMinor,
      },
    ],
  });

  // Insert transfer record
  const transferResult = await client.query(
    `INSERT INTO transfers (
      from_account_id,
      to_account_id,
      amount,
      currency,
      status,
      ledger_transaction_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [
      input.fromAccountId,
      input.toAccountId,
      String(input.amountMinor),
      fromCurrency,
      'COMPLETED',
      ledgerTransactionId,
    ]
  );

  const transferId = transferResult.rows[0].id as string;

  return {
    transferId,
    ledgerTransactionId,
  };
}

export async function createTransfer(
  input: CreateTransferInput
): Promise<CreateTransferResult> {
  return withTransaction((client) => createTransferOnClient(client, input));
}

export async function getTransfer(
  transferId: string
): Promise<{ id: string; fromAccountId: string; toAccountId: string; amount: string; currency: string; status: string; ledgerTransactionId: string | null; createdAt: string } | null> {
  const result = await pool.query(
    `SELECT id, from_account_id, to_account_id, amount, currency, status, ledger_transaction_id, created_at
     FROM transfers
     WHERE id = $1`,
    [transferId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    ledgerTransactionId: row.ledger_transaction_id,
    createdAt: row.created_at,
  };
}
