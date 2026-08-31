# ADR-004: Transfers as Business Operations, Separate from Ledger Facts

**Status:** Accepted (2026-08-30)

## Context

The ledger stores only completed facts — the immutable transactions that
happened. But a transfer request's real life is richer: it has a status,
a way to detect duplicate requests, and a link to the ledger transaction
that (maybe) executed it. This cannot live in `ledger_transactions`,
because doing so would entangle the immutable fact-store with operational
state that changes over time and that may not produce any ledger entries
at all (a rejected transfer, for example). The ledger must remain a
journal of what actually happened; the transfers table tracks what was
attempted.

## Decision

Create a separate `transfers` table:

- `id` (PK): the transfer's identity
- `from_account_id`, `to_account_id`, `amount`, `currency`
- `status`: COMPLETED or FAILED (PENDING and others arrive with the
  Phase 7 state machine)
- `ledger_transaction_id` (FK): the ledger transaction that executed this
  transfer
- `created_at`

A transfer is a business operation; a ledger transaction is a fact.
They are linked via FK but conceptually separate. The transfer row is
where idempotency keys, retry metadata, and the status lifecycle attach.
The ledger row is pure history.

## Consequences

- **Idempotency keying** (ADR-005) has a clear home on the operation
  side, not in the ledger.
- **The Phase 7 state machine** (PENDING → COMPLETED/FAILED) will live
  here, never in `ledger_transactions`.
- **Failed attempts** currently leave a durable record only in
  `idempotency_keys` (the stored failure response). Recording FAILED
  transfer rows is planned alongside the Phase 7 state machine — the
  status column already permits it.
- **One business operation = two linked records**: transfer (operation)
  + ledger transaction (fact), joined by FK.
- The transfer row's `amount` and its ledger entries are kept consistent
  by code (`createTransfer` posts both in one database transaction), not
  by a constraint — they live in different tables.