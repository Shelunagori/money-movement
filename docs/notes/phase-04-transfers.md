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

## Testing Notes

- Test suite creates temporary accounts with prefix `test_tr_` and cleans them up in `afterAll`.
- Each test either commits a transfer (and checks ledger entries + balances) or fails early (and checks no rows exist).
- Schema validation is tested separately for all boundary cases: amountMinor 0, negative, string, float.
