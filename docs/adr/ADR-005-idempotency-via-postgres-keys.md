# ADR-005: Idempotency via Postgres-Claimed Keys

**Status:** Accepted (2026-08-30)

## Context

An HTTP request to `POST /transfers` may time out on the network. The
client then does not know: did the transfer execute, or not? Without
idempotency it must either retry (risking a double-debit) or give up
(risking a lost transfer). The server must guarantee: a retry with the
same key gets the same outcome, and the operation executes at most once
— even if two identical requests arrive at the same instant.

That guarantee must itself be race-safe. PostgreSQL's PRIMARY KEY
uniqueness is atomic under any level of concurrency, so we build on it.

## Decision

An `idempotency_keys` table:

- `key` (TEXT PRIMARY KEY): the client-supplied Idempotency-Key header
- `request_hash`: SHA-256 of the request body, to detect
  same-key-different-body reuse
- `status`: IN_PROGRESS or COMPLETED
- `response_status`, `response_body`: the response to replay on retry
- `created_at`: for a future expiry policy

**Claiming a key** is one atomic statement:

```sql
INSERT INTO idempotency_keys (key, request_hash, status)
VALUES ($1, $2, 'IN_PROGRESS')
ON CONFLICT (key) DO NOTHING
RETURNING *;
```

If a row comes back, this request owns the key and proceeds. Otherwise
the existing row decides: different `request_hash` → 409; status
IN_PROGRESS → 409; status COMPLETED → replay the stored response.

**Recording the response happens inside the transfer's own database
transaction** — the transfer and its recorded response commit together
or not at all. If the process crashes after COMMIT but before the client
receives the response, the key is already COMPLETED and the retry
replays the same response.

Why this design: the PRIMARY KEY makes claiming race-safe (exactly one
of any number of concurrent identical requests wins the INSERT);
same-transaction recording means a replayed request can never observe
"transfer happened but no stored response"; and rejecting a reused key
with a different body prevents a different operation from silently
executing under an old key.

## Consequences

- **At-most-once execution per key.** Concurrent duplicates lose the
  claim race and see IN_PROGRESS (409) or the completed response.
- **Stale IN_PROGRESS keys are reclaimed after 15 minutes.** A crash or
  network failure that leaves a key IN_PROGRESS is automatically recovered:
  after 15 minutes, a new request with the same key triggers an atomic
  UPDATE that reclaims the key and re-executes the transfer. Tradeoff: if
  the original request is still running after 15 minutes (extremely unlikely
  for transfers, which complete in milliseconds), the operation could
  double-execute. Production systems pair this with request-level timeouts.
- **Clients must send Idempotency-Key** — requests without it are
  rejected with 400.
- **Same key + different body is an error (409), never a retry** — the
  client must choose a new key to execute a different transfer.
- **Deterministic business failures (422/404) are completed into the
  key** — retrying a failed transfer replays the same failure rather
  than re-executing it.
- **Unexpected errors delete the claim**: any unexpected error rolls
  back the entire transaction — transfer included, nothing committed —
  so the claim row is released and a retry may re-execute from scratch.
  Only deterministic failures keep their claim.