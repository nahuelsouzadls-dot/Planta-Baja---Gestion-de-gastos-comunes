from django.db import migrations


TRIGGER_FUNCTIONS = """
CREATE FUNCTION settlements_prevent_issued_change() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'issued' THEN
        RAISE EXCEPTION 'La liquidación ya fue emitida y no se puede modificar: registrá un ajuste';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION settlement_items_prevent_issued_change() RETURNS trigger AS $$
DECLARE
    settlement_status text;
    settlement_id uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        settlement_id := OLD.settlement_id;
    ELSE
        settlement_id := NEW.settlement_id;
    END IF;

    SELECT status INTO settlement_status
    FROM settlements_settlement
    WHERE id = settlement_id;

    IF settlement_status = 'issued' THEN
        RAISE EXCEPTION 'La liquidación ya fue emitida y no se puede modificar: registrá un ajuste';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settlement_no_issued_update_delete
BEFORE UPDATE OR DELETE ON settlements_settlement
FOR EACH ROW EXECUTE FUNCTION settlements_prevent_issued_change();

CREATE TRIGGER settlementitem_no_issued_insert_update_delete
BEFORE INSERT OR UPDATE OR DELETE ON settlements_settlementitem
FOR EACH ROW EXECUTE FUNCTION settlement_items_prevent_issued_change();
"""

DROP_TRIGGERS = """
DROP TRIGGER IF EXISTS settlementitem_no_issued_insert_update_delete ON settlements_settlementitem;
DROP TRIGGER IF EXISTS settlement_no_issued_update_delete ON settlements_settlement;
DROP FUNCTION IF EXISTS settlement_items_prevent_issued_change();
DROP FUNCTION IF EXISTS settlements_prevent_issued_change();
"""


class Migration(migrations.Migration):
    dependencies = [
        ('settlements', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(TRIGGER_FUNCTIONS, reverse_sql=DROP_TRIGGERS),
    ]
