# Money Movement Ledger

[![CI](https://github.com/anthropics/money-movement/actions/workflows/ci.yml/badge.svg)](https://github.com/anthropics/money-movement/actions/workflows/ci.yml)

A production-style money movement backend built from scratch in TypeScript,
with a focus on the problems that make financial systems hard: atomicity,
exact arithmetic, idempotency, concurrency, and reconciliation.

**This is a learning-in-public project, built incrementally.** Every design
decision is documented in [`docs/adr/`](docs/adr/), and every module is
built failure-first: the failure tests were written before the happy paths
were trusted.

## Built and tested so far

- **Double-entry ledger with database-enforced invariants** — every
  transaction's debits must equal its credits (fail-fast code guards for UX,
  enforced by a deferred database trigger at commit time, verified by a global
  invariant test over the whole ledger); amounts are `BIGINT` with
  `CHECK (amount > 0)`; account and direction validity are enforced by FK and
  CHECK constraints, not application discipline
- **Tamper-proof history** — ledger entries are immutable at the
  database level: a trigger rejects every `UPDATE` and `DELETE`, and a
  test proves it by trying both
- **Atomic internal transfers** — POST /transfers posts a balanced
  ledger transaction and the transfer record in one database
  transaction; insufficient funds, unknown accounts, and currency
  mismatches are rejected and persist nothing
- **Idempotent money movement** — every transfer requires an
  Idempotency-Key; duplicate and concurrent retries replay the stored
  response and move money exactly once (proven by a concurrent-
  duplicates test); same key with a different body is rejected with 409
- **Concurrency-safe spending** — account rows are locked in sorted
  order (SELECT FOR UPDATE), so parallel transfers serialize per
  account: 10 concurrent spends against one balance cannot overspend,
  and opposite-direction transfers cannot deadlock — all proven by
  parallel tests
- **Balances derived, never stored** — an account's balance is computed
  from its immutable entries, so it is reproducible from history at any
  point in time
- **Multi-leg transactions** — a transfer with a fee split posts as one
  atomic transaction with three balanced entries, not as bolted-on
  arithmetic
- **Exact money representation** — integer minor units in `bigint`;
  no floats anywhere near an amount; currency is attached to every value
  and mismatches are rejected at both the Money and ledger level
- **Fail-fast, fail-loud startup** — all config is parsed and validated
  before any money code can run; a missing env var kills the deploy,
  not a 11 PM transfer
- **Degrade-don't-crash runtime** — a PostgreSQL outage turns into 503s
  plus structured warn logs, and the service recovers without a restart
  (found and fixed a real crash here: `pg` pools emit errors on idle
  connections, outside any try/catch)
- **Strict TypeScript foundation** — `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; empty query results are compile-time
  concerns, not runtime surprises
- **41 tests via Vitest** — unit + integration, failure paths first:
  unbalanced, mixed-currency, and single-entry transactions are proven
  to persist nothing; concurrency-safe spending verified under 10-way
  parallel load and opposite-direction transfers

## Why these choices

**Modular monolith + worker, one PostgreSQL.** The core invariant of a
ledger — all entries of one operation commit atomically or not at all —
lives inside single-database ACID transactions. A service boundary through
the ledger would destroy exactly the guarantee this system exists to provide.

**Raw SQL over an ORM.** Financial correctness comes directly from
PostgreSQL: row locking (`SELECT FOR UPDATE`), isolation levels, and
transaction boundaries that are visible in the code as explicit
`BEGIN`/`COMMIT`/`ROLLBACK`. If a tool hides those mechanisms, it is also
hiding part of the system's correctness model.

## Roadmap (in build order)

~~Double-entry ledger with enforced debits=credits~~ ✅ →
~~atomic internal transfers~~ ✅ → ~~idempotency keys~~ ✅ →
~~concurrency control~~ ✅ → transaction state machine (in progress) →
simulated payment provider with injected failures → transactional outbox →
retries with backoff → webhook dedup/out-of-order handling → reconciliation
engine → card auth/capture/refund lifecycle.

## Run

```bash
docker compose up -d
cp .env.example .env
npm install
npm run dev     # API on :3000
```

## Test

```bash
npm test
```