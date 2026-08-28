-- Up Migration
CREATE TABLE ledger_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL UNIQUE,
    type          TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY')),
    currency      CHAR(3) NOT NULL,
    owner_user_id UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL,
    description TEXT,
    metadata    JSONB,
    posted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
    ledger_account_id     UUID NOT NULL REFERENCES ledger_accounts(id),
    direction             TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount                BIGINT NOT NULL CHECK (amount > 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_entries_account ON ledger_entries (ledger_account_id);
CREATE INDEX idx_ledger_entries_transaction ON ledger_entries (ledger_transaction_id);

-- Down Migration

DROP TABLE ledger_entries;
DROP TABLE ledger_transactions;
DROP TABLE ledger_accounts;