# Money Movement Ledger

A production-style money movement backend built from scratch in TypeScript,
with a focus on the problems that make financial systems hard: atomicity,
exact arithmetic, idempotency, concurrency, and reconciliation.

**This is a learning-in-public project, built incrementally.** Every design
decision is documented in [`docs/adr/`](docs/adr/), and every module is
built failure-first: the failure tests were written before the happy paths
were trusted.

## Built and tested so far

- **Double-entry ledger with database-enforced invariants** — every
  transaction's debits must equal its credits (guarded in code, verified
  by a global invariant test over the whole ledger); amounts are
  `BIGINT` with `CHECK (amount > 0)`; account and direction validity
  are enforced by FK and CHECK constraints, not application discipline
- **Tamper-proof history** — ledger entries are immutable at the
  database level: a trigger rejects every `UPDATE` and `DELETE`, and a
  test proves it by trying both
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
- **21 tests via Vitest** — unit + integration, failure paths first:
  unbalanced, mixed-currency, and single-entry transactions are proven
  to persist nothing

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

~~Double-entry ledger with enforced debits=credits~~ ✅ → atomic internal
transfers (in progress) → idempotency keys → concurrency control
(SELECT FOR UPDATE, tested under parallel load) → transaction state
machine → simulated payment provider with injected failures →
transactional outbox → retries with backoff → webhook dedup/out-of-order
handling → reconciliation engine → card auth/capture/refund lifecycle.

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