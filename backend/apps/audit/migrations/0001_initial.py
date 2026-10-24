from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.db.models.functions.datetime
import uuid

from apps.audit.operations import AuditTrigger


AUDITED_TABLES = (
    ('accounts_user', ('password',)),
    ('accounts_organization', ()),
    ('accounts_orgmembership', ()),
    ('buildings_building', ()),
    ('buildings_unit', ()),
    ('buildings_expenseconcept', ()),
    ('people_person', ()),
    ('people_occupancy', ()),
    ('settlements_settlement', ()),
    ('settlements_settlementitem', ()),
    ('ledger_ledgerentry', ()),
)


AUDIT_FUNCTION_SQL = r"""
CREATE FUNCTION audit_row_change() RETURNS trigger AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
  item record;
  sensitive boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW) - COALESCE(TG_ARGV, ARRAY[]::text[]);
    INSERT INTO audit_rowchange (
      table_name, row_id, operation, old_values, new_values,
      actor_id, organization_id, db_user, request_ip, request_path
    ) VALUES (
      TG_TABLE_NAME, NEW.id, TG_OP, NULL, new_row,
      NULLIF(current_setting('app.actor_id', true), '')::uuid,
      NULLIF(current_setting('app.organization_id', true), '')::uuid,
      current_user,
      COALESCE(current_setting('app.request_ip', true), ''),
      COALESCE(current_setting('app.request_path', true), '')
    );
  ELSIF TG_OP = 'DELETE' THEN
    old_row := to_jsonb(OLD) - COALESCE(TG_ARGV, ARRAY[]::text[]);
    INSERT INTO audit_rowchange (
      table_name, row_id, operation, old_values, new_values,
      actor_id, organization_id, db_user, request_ip, request_path
    ) VALUES (
      TG_TABLE_NAME, OLD.id, TG_OP, old_row, NULL,
      NULLIF(current_setting('app.actor_id', true), '')::uuid,
      NULLIF(current_setting('app.organization_id', true), '')::uuid,
      current_user,
      COALESCE(current_setting('app.request_ip', true), ''),
      COALESCE(current_setting('app.request_path', true), '')
    );
  ELSE
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    FOR item IN SELECT key, value FROM jsonb_each(new_row) LOOP
      IF item.key = 'updated_at' THEN
        CONTINUE;
      END IF;
      IF (old_row -> item.key) IS NOT DISTINCT FROM item.value THEN
        CONTINUE;
      END IF;
      sensitive := item.key = ANY(TG_ARGV);
      IF sensitive THEN
        old_diff := old_diff || jsonb_build_object(item.key, '[cambiado]');
        new_diff := new_diff || jsonb_build_object(item.key, '[cambiado]');
      ELSE
        old_diff := old_diff || jsonb_build_object(item.key, old_row -> item.key);
        new_diff := new_diff || jsonb_build_object(item.key, item.value);
      END IF;
    END LOOP;
    IF old_diff = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    INSERT INTO audit_rowchange (
      table_name, row_id, operation, old_values, new_values,
      actor_id, organization_id, db_user, request_ip, request_path
    ) VALUES (
      TG_TABLE_NAME, NEW.id, TG_OP, old_diff, new_diff,
      NULLIF(current_setting('app.actor_id', true), '')::uuid,
      NULLIF(current_setting('app.organization_id', true), '')::uuid,
      current_user,
      COALESCE(current_setting('app.request_ip', true), ''),
      COALESCE(current_setting('app.request_path', true), '')
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION audit_rowchange_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_rowchange es append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_rowchange_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_rowchange
  FOR EACH ROW EXECUTE FUNCTION audit_rowchange_append_only();

CREATE TRIGGER audit_rowchange_no_truncate
  BEFORE TRUNCATE ON audit_rowchange
  FOR EACH STATEMENT EXECUTE FUNCTION audit_rowchange_append_only();
"""

AUDIT_FUNCTION_REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS audit_rowchange_no_update_delete ON audit_rowchange;
DROP TRIGGER IF EXISTS audit_rowchange_no_truncate ON audit_rowchange;
DROP FUNCTION IF EXISTS audit_rowchange_append_only();
DROP FUNCTION IF EXISTS audit_row_change();
"""


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ('accounts', '0001_initial'),
        ('buildings', '0001_initial'),
        ('people', '0001_initial'),
        ('settlements', '0002_immutable_issued'),
        ('ledger', '0002_append_only'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='RowChange',
            fields=[
                ('id', models.UUIDField(
                    db_default=models.Func(function='gen_random_uuid'),
                    default=uuid.uuid4,
                    editable=False,
                    primary_key=True,
                    serialize=False,
                )),
                ('table_name', models.CharField(max_length=63)),
                ('row_id', models.UUIDField()),
                ('operation', models.CharField(
                    choices=[('INSERT', 'INSERT'), ('UPDATE', 'UPDATE'), ('DELETE', 'DELETE')],
                    max_length=6,
                )),
                ('old_values', models.JSONField(null=True)),
                ('new_values', models.JSONField(null=True)),
                ('organization_id', models.UUIDField(blank=True, null=True)),
                ('db_user', models.CharField(max_length=63)),
                ('request_ip', models.CharField(blank=True, max_length=45)),
                ('request_path', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(
                    db_default=django.db.models.functions.datetime.Now(),
                )),
                ('actor', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['table_name', 'row_id'], name='audit_rowchange_table_row_idx'),
                    models.Index(fields=['actor', 'created_at'], name='audit_rowchange_actor_date_idx'),
                    models.Index(fields=['created_at'], name='audit_rowchange_created_idx'),
                ],
            },
        ),
        migrations.RunSQL(AUDIT_FUNCTION_SQL, AUDIT_FUNCTION_REVERSE_SQL),
        *[AuditTrigger(table, exclude=exclude) for table, exclude in AUDITED_TABLES],
    ]
