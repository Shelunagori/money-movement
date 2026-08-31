# ADR-006: Pessimistic Locking for Concurrency-Safe Spending

**Status:** Accepted (2026-08-31)

## Context

A transfer reads an account's balance, checks if funds are sufficient, and if so,
debits the account. Without synchronization, two parallel transfers can both read
the same balance and both decide there are sufficient funds:

```
Balance is 10000
Transfer A reads 10000, plans to debit 8000 → "OK, will be 2000"
Transfer B reads 10000, plans to debit 8000 → "OK, will be 2000"
Both commit → actual balance is -6000 (overspent)
```

Under PostgreSQL's default isolation level (READ COMMITTED), each query sees committed
data, but the database does not guarantee that the data read remains true during the
transaction. The balance is **derived** (a SUM of ledger entries), not stored in a
single row, so there is no natural lock anchor.

Optimistic locking (version columns) or SERIALIZABLE isolation both exist, but they
require retry loops on conflict — unacceptable in a money path. Pessimistic locking
prevents the problem by holding an exclusive lock on the account row during the entire
transaction.

## Decision

Execute `SELECT ... FOR UPDATE` on the `ledger_accounts` row(s) before reading the
balance. Lock both accounts involved in a transfer in **sorted id order** (via
`ORDER BY id`). This ensures:

1. **Per-account serialization:** Only one transaction can hold an exclusive lock on
   an account row at a time. A concurrent transfer to the same account must wait.
2. **Deadlock prevention:** By always locking accounts in the same universal order
   (sorted by id), opposite-direction transfers (A→B vs B→A) acquire locks in the same
   sequence and cannot deadlock.

For example, if a transfer involves accounts `acc1` and `acc2`, the query is:

```sql
SELECT id, currency FROM ledger_accounts
WHERE id = ANY($1)
ORDER BY id FOR UPDATE
```

The `FOR UPDATE` clause acquires an exclusive row lock; `ORDER BY id` ensures
locks are acquired in sorted order. The balance check that follows is safe:
concurrent transfers on the same account are serialized by the lock.

## Consequences

- **Per-account spending is serialized.** A hot account becomes a throughput ceiling:
  only one transfer in/out can proceed at a time. Uncontended accounts are not affected.
- **Lock waits add latency under contention.** A client waiting for another transfer to
  finish sees a delay; there is no fallback or fast-path.
- **Deadlock is impossible for transfers** (not true for arbitrary transactions): the
  universal lock order prevents circular wait cycles.
- **No retry loops:** Unlike optimistic approaches, a pessimistic lock either succeeds
  or waits — it never conflicts after the lock is held.
- **Works with any isolation level.** The lock prevents the race condition regardless
  of isolation semantics.
