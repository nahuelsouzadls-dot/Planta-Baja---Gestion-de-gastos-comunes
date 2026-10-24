from django.db import migrations


SQL = """
CREATE OR REPLACE FUNCTION settlement_items_prevent_issued_change() RETURNS trigger AS $$
DECLARE
    settlement_status text;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT status INTO settlement_status
        FROM settlements_settlement
        WHERE id = OLD.settlement_id;
        IF settlement_status = 'issued' THEN
            RAISE EXCEPTION 'La liquidación ya fue emitida y no se puede modificar: registrá un ajuste';
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT status INTO settlement_status
        FROM settlements_settlement
        WHERE id = NEW.settlement_id;
        IF settlement_status = 'issued' THEN
            RAISE EXCEPTION 'La liquidación ya fue emitida y no se puede modificar: registrá un ajuste';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION settlements_prevent_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Las liquidaciones no se pueden truncar';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settlement_no_truncate ON settlements_settlement;
DROP TRIGGER IF EXISTS settlementitem_no_truncate ON settlements_settlementitem;

CREATE TRIGGER settlement_no_truncate
BEFORE TRUNCATE ON settlements_settlement
FOR EACH STATEMENT EXECUTE FUNCTION settlements_prevent_truncate();

CREATE TRIGGER settlementitem_no_truncate
BEFORE TRUNCATE ON settlements_settlementitem
FOR EACH STATEMENT EXECUTE FUNCTION settlements_prevent_truncate();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS settlementitem_no_truncate ON settlements_settlementitem;
DROP TRIGGER IF EXISTS settlement_no_truncate ON settlements_settlement;
DROP FUNCTION IF EXISTS settlements_prevent_truncate();
"""


class Migration(migrations.Migration):
    dependencies = [('settlements', '0002_immutable_issued')]
    operations = [migrations.RunSQL(SQL, REVERSE_SQL)]
