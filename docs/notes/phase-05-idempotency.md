# Phase 5: Idempotent Transfers

## Design Rationale

### Why HTTP Timeouts Don't Mean Failure

A client sending `POST /transfers` may receive a timeout or network failure without knowing whether the request executed on the server. Did the transfer happen, or not? Without idempotency, the client must either:
1. Assume failure and retry, risking double-transfer
2. Assume success and skip, risking lost transfer

The `Idempotency-Key` header solves this: the client can safely retry with the same key, and the server guarantees exactly-once semantics.

### PRIMARY KEY Makes Claims Race-Safe

The core mechanism is PostgreSQL's PRIMARY KEY constraint on `idempotency_keys.key`. When two concurrent requests arrive with the same key:

```sql
INSERT INTO idempotency_keys (key, request_hash, status)
VALUES ($1, $2, 'IN_PROGRESS')
ON CONFLICT (key) DO NOTHING
RETURNING *;
```

- One INSERT succeeds (returns a row): that request claims the key and executes the transfer.
- The other INSERT silently fails (returns no rows): that request detects the conflict and waits or returns 409.

Even under high concurrency, exactly one request claims the key. No race condition possible.

### Why completeKey Must Share the Transfer's Transaction

The key insight: transfer execution and response recording must commit atomically.

```
Timeline of danger without atomicity:
1. Transfer commits (ledger entries, balance updated)
2. [CRASH]
3. Response recording never happens
4. Client retries with same key
5. Key still says IN_PROGRESS → 409 error
6. Client never learns the transfer succeeded

Solution: completeKey runs INSIDE the same transaction as createTransferOnClient.
Both commit together, or both rollback. If the process crashes mid-flight, the
key stays IN_PROGRESS, and retry will see that and return 409 (safe, prevents
second debit).
```

### Known Limitation: IN_PROGRESS Forever

If a process crashes while status='IN_PROGRESS', the key is locked forever. A retry will always see IN_PROGRESS and return 409. Production systems solve this with:
- Expiry policy: key expires after 24 hours, can be reclaimed
- Manual reclaim: operator deletes stuck rows, allowing retry

Phase 5 does not implement expiry. It's acceptable for a dev/test environment.

### Why Same-Key-Different-Body Must Be 409

A POST `/transfers` with key K and body B1 creates a transfer. If a later request arrives with key K and body B2 (different), we don't know if it's:
- A genuine retry with a typo in the body (client error)
- A man-in-the-middle attack changing the body
- A bug

Returning 409 forces the client to use a new key and prevents silent mismatches. The client MUST acknowledge the mismatch explicitly, not silently execute a different transfer.

---

## Implementation Notes

- `hashRequestBody()` uses SHA256 on the JSON request body.
- `claimKey()` uses INSERT ... ON CONFLICT, which is atomic.
- `completeKey()` updates the row and stores response_body as JSONB for exact replay.
- Routes check the Idempotency-Key header; missing → 400.
- Business errors (4xx) are recorded in the key so retries replay them.
- Unexpected errors (5xx) delete the claim so retries can re-execute.

---

## Interview Questions & Answers

### Q1: What happens if the client sends the same key with a different request body?

**A**: The server returns 409 Conflict with the error "Idempotency key reused with different request body". This is intentional — it prevents silent misexecution if a client mistakenly retries with altered parameters.

### Q2: How does the PRIMARY KEY on idempotency_keys.key ensure race safety?

**A**: When two concurrent requests try `INSERT ... ON CONFLICT (key) DO NOTHING`, PostgreSQL's uniqueness constraint ensures exactly one succeeds. The INSERT is atomic — no two requests can both claim the same key, even under extreme concurrency.

### Q3: Why must completeKey run inside the transfer's transaction?

**A**: If the transfer commits but the response-recording crashes, a retry will see the key as still IN_PROGRESS and return 409, never learning the transfer succeeded. By keeping both in the same transaction, they commit or rollback together, preserving the invariant: if the transfer happened, the response is recorded.

### Q4: What does the Idempotency-Replay header indicate?

**A**: It signals that the response is replayed from a previous request, not freshly computed. The client can log this for debugging. The response body and status code are identical to what was returned before.

### Q5: How are business errors (e.g. insufficient funds) handled differently from crashes?

**A**: Business errors (422 Insufficient Funds, 404 Unknown Account) are recorded in the idempotency key with status COMPLETED. A retry replays the same error. Unexpected errors (5xx) cause the claim row to be deleted, allowing a retry to re-execute from scratch. This distinction preserves the invariant: 4xx errors are idempotent, 5xx errors require server recovery.

---

## Testing Notes

- Tests use keys like `test-idem-<scenario>-<timestamp>` to avoid collisions.
- The concurrent test fires two identical POSTs via `Promise.all()` and verifies exactly one transfer row exists.
- Failed requests (insufficient funds) are retried and verified to replay the same 422 error.
- All keys are cleaned up in afterAll with `DELETE FROM idempotency_keys WHERE key LIKE 'test-idem-%'`.
