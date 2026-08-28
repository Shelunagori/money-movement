# Money Movement Ledger

A production-style double-entry ledger and money movement backend,
built as a learning project. TypeScript, Node.js, PostgreSQL, Fastify.

Work in progress — being built incrementally with a focus on
financial correctness: atomicity, idempotency, concurrency safety,
and reconciliation. See `docs/adr/` for architecture decisions.

## Run

docker compose up -d      # PostgreSQL
cp .env.example .env
npm install
npm run dev               # API on :3000

## Test

npm test