from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid

APPEND_ONLY_SQL = """
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_auditlog
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_auditlog
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_auditlog;
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_auditlog;
DROP FUNCTION IF EXISTS audit_log_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [
        ('audit', '0001_initial'),
        ('accounts', '0002_user_email_constraints'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('action', models.CharField(max_length=60)),
                ('target_type', models.CharField(max_length=60)),
                ('target_id', models.UUIDField()),
                ('summary', models.CharField(max_length=300)),
                ('data', models.JSONField()),
                ('actor', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('organization', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to='accounts.organization',
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['organization', 'created_at'], name='audit_log_org_date_idx'),
                    models.Index(fields=['actor', 'created_at'], name='audit_log_actor_date_idx'),
                    models.Index(fields=['target_type', 'target_id'], name='audit_log_target_idx'),
                ],
            },
        ),
        migrations.RunSQL(APPEND_ONLY_SQL, REVERSE_SQL),
    ]
