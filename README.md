# Money Movement Ledger

A production-style money movement backend built from scratch in TypeScript,
with a focus on the problems that make financial systems hard: atomicity,
exact arithmetic, idempotency, concurrency, and reconciliation.

**This is a learning-in-public project, built incrementally.** Every design
decision is documented in [`docs/adr/`](docs/adr/), and every module is
built failure-first: the failure tests were written before the happy paths
were trusted.

## Built and tested so far

- **Strict TypeScript foundation** — `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; empty query results are compile-time
  concerns, not runtime surprises
- **Fail-fast, fail-loud startup** — all config is parsed and validated
  before any money code can run; a missing env var kills the deploy,
  not a 11 PM transfer
- **Degrade-don't-crash runtime** — a PostgreSQL outage turns into
  503s + structured warn logs, and the service recovers without a
  restart (found and fixed a real crash here: `pg` pools emit errors
  on idle connections, outside any try/catch)
- **Exact money representation** — integer minor units in `bigint`;
  no floats anywhere near an amount; currency is attached to every
  value and mismatches throw
- **Integration + unit tests** via Vitest, including failure paths

## Roadmap (in build order)

Double-entry ledger with enforced debits=credits → atomic internal
transfers → idempotency keys → concurrency control (SELECT FOR UPDATE,
tested under parallel load) → transaction state machine → simulated
payment provider with injected failures → transactional outbox →
retries with backoff → webhook dedup/out-of-order handling →
reconciliation engine → card auth/capture/refund lifecycle.

## Why these choices

This starts as a monolith because the hard problems here are correctness and transaction boundaries, not distributed systems. Keeping the ledger and transfer logic in one process makes those guarantees easier to reason about and test.

I’m using raw SQL because database behavior is part of the system design: transactions, locks, constraints, and failure modes need to stay visible. For a money movement system, I’d rather understand exactly what PostgreSQL is doing than hide those details behind an ORM.

## Run

docker compose up -d
cp .env.example .env
npm install
npm run dev     # API on :3000

## Test

npm test