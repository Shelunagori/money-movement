-- Up Migration
CREATE FUNCTION forbid_ledger_entry_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION forbid_ledger_entry_change();

-- Down Migration
DROP TRIGGER ledger_entries_immutable ON ledger_entries;
DROP FUNCTION forbid_ledger_entry_change();