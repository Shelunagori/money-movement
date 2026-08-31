-- Up Migration
CREATE FUNCTION check_ledger_transaction_balanced() RETURNS trigger AS $$
DECLARE
  debit_total  BIGINT;
  credit_total BIGINT;
  entry_count  INT;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0),
    COUNT(*)
  INTO debit_total, credit_total, entry_count
  FROM ledger_entries
  WHERE ledger_transaction_id = NEW.ledger_transaction_id;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'unbalanced ledger transaction %: debits=% credits=%',
      NEW.ledger_transaction_id, debit_total, credit_total;
  END IF;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has fewer than two entries',
      NEW.ledger_transaction_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_ledger_transaction_balanced();

-- Down Migration
DROP TRIGGER ledger_entries_balanced ON ledger_entries;
DROP FUNCTION check_ledger_transaction_balanced();
