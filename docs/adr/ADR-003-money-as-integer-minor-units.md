# ADR-003: Money as Integer Minor Units

## Status
Accepted (2026-08-28)

## Context
JavaScript numbers are IEEE-754 floats: `0.1 + 0.2` evaluates to 0.30000000000000004.
Even integer amounts in `number` silently lose precision beyond
Number.MAX_SAFE_INTEGER — e.g. 9007199254740992 === 9007199254740993 is true.
Financial amounts must be exact.

## Decision
Store all amounts as integer minor units (paise/cents): bigint in TypeScript,
bigint in PostgreSQL. Every amount always carries a currency code, because
1099 INR-paise and 1099 USD-cents are different amounts. The API accepts only integer
minor units — decimal amounts like 10.999 are rejected, not rounded, because
rounding would move a different amount than the user authorized.

## Consequences
Rounding only applies where the system itself creates fractions (fees, FX) —
deferred until those phases. Display formatting is the UI's job. Money is
currently constructed only in our own code; a validating constructor will be
added when external data (API/DB) starts producing Money values.