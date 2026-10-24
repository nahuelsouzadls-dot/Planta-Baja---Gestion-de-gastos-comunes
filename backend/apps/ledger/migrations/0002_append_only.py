from django.db import migrations


SQL = """
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_ledgerentry es append-only: registrá un asiento de ajuste';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledgerentry_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_ledgerentry
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledgerentry_no_truncate
  BEFORE TRUNCATE ON ledger_ledgerentry
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS ledgerentry_no_update_delete ON ledger_ledgerentry;
DROP TRIGGER IF EXISTS ledgerentry_no_truncate ON ledger_ledgerentry;
DROP FUNCTION IF EXISTS ledger_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [('ledger', '0001_initial')]
    operations = [migrations.RunSQL(SQL, REVERSE_SQL)]
