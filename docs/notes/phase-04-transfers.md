# Phase 4: Internal Transfers

## Design Rationale

### Why Transfers Table is Separate from Ledger Transactions

The `transfers` table records **operations** (user-initiated transfer requests) while `ledger_transactions` record **facts** (immutable double-entry records). This separation enables:

1. **Idempotency attachment**: Transfer rows can have status (COMPLETED, FAILED, PENDING) to support retries and idempotent operation tracking without compromising ledger immutability.
2. **Operation history**: A single failed transfer attempt (no ledger record) vs. a retried successful transfer (one ledger record) both show up in the transfers log for audit purposes.
3. **Status lifecycle**: Future phases can add asynchronous processing (Phase 5+) where a transfer starts PENDING, then transitions to COMPLETED/FAILED after processing.

Example: If a transfer request fails to acquire a lock (Phase 6), we record the failed transfer row (status: FAILED) but no ledger entries, allowing the client to see the attempt and retry with a new transfer ID.

### Balance Check Concurrency Safety

The balance check in `createTransfer` is **not yet concurrency-safe**:

```sql
SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END), 0) AS balance
FROM ledger_entries
WHERE ledger_account_id = $1
```

Two parallel transfers can both pass this check if they race:
- Transfer A reads balance 10000, deducts 5000 → thinks balance will be 5000 ✓
- Transfer B reads balance 10000, deducts 6000 → thinks balance will be 4000 ✓
- Both commit → actual balance is -1000 (overdraft)

**Phase 6 fix**: Add `SELECT ... FOR UPDATE` on the account row before the balance check to serialize concurrent transfers on the same account:

```sql
SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE;
```

This holds an exclusive lock until the transaction commits, forcing serialization.

### Error Code Mapping

- **404 Unknown Account**: The account ID(s) don't exist in `ledger_accounts`.
- **422 Insufficient Funds**: Balance is too low; client should ask user to top up.
- **422 Currency Mismatch**: Accounts use different currencies; client should show a currency selector.
- **400 Schema Validation**: Invalid payload (amountMinor not a positive integer, missing fields, etc.); client submitted malformed JSON.

---

## Interview Questions & Answers

### Q1: Why is the balance check not concurrency-safe, and what's the Phase 6 solution?

**A**: Two parallel transfers on the same account can both read the balance before either commits, both pass the check, and overdraw the account. Phase 6 fixes this with `SELECT ... FOR UPDATE` to lock the account row, serializing concurrent operations on the same account and preventing the race.

### Q2: Why do we refactor `postLedgerTransaction` into `postLedgerTransactionOnClient`?

**A**: The transfers flow needs to post a ledger transaction as part of a larger atomic operation (balance check, transfer record insertion). Extracting the logic lets transfers call it on the same DB client within the same transaction, ensuring all-or-nothing semantics.

### Q3: How does the transfers table support idempotent retry?

**A**: Future phases can use a transfer `id` as an idempotency key. A client retrying with the same transfer ID finds the existing COMPLETED or FAILED row and doesn't create a duplicate. Currently Phase 4 doesn't implement retry logic, but the schema is ready.

### Q4: What prevents a transfer from an account to itself?

**A**: The database constraint `CHECK (from_account_id <> to_account_id)` rejects any insert where both IDs are the same, returning a 422 error. This is a hard constraint, not just application logic.

### Q5: Why is the currency in the transfers table separate from querying ledger_accounts each time?

**A**: Denormalizing the currency into the transfers row avoids a join and provides a snapshot of the currency at transfer time (useful if account types/currencies change in the future). It also simplifies the GET /transfers/:id response without requiring extra queries.

---

## Testing Notes

- Test suite creates temporary accounts with prefix `test_tr_` and cleans them up in `afterAll`.
- Each test either commits a transfer (and checks ledger entries + balances) or fails early (and checks no rows exist).
- Schema validation is tested separately for all boundary cases: amountMinor 0, negative, string, float.
