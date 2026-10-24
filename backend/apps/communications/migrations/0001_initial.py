import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

from apps.audit.operations import AuditTrigger


APPEND_ONLY_SQL = """
CREATE FUNCTION communications_claimmessage_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'communications_claimmessage es append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claimmessage_no_update_delete
  BEFORE UPDATE OR DELETE ON communications_claimmessage
  FOR EACH ROW EXECUTE FUNCTION communications_claimmessage_append_only();

CREATE TRIGGER claimmessage_no_truncate
  BEFORE TRUNCATE ON communications_claimmessage
  FOR EACH STATEMENT EXECUTE FUNCTION communications_claimmessage_append_only();
"""

APPEND_ONLY_REVERSE_SQL = """
DROP TRIGGER IF EXISTS claimmessage_no_update_delete ON communications_claimmessage;
DROP TRIGGER IF EXISTS claimmessage_no_truncate ON communications_claimmessage;
DROP FUNCTION IF EXISTS communications_claimmessage_append_only();
"""


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('accounts', '0001_initial'),
        ('audit', '0001_initial'),
        ('buildings', '0001_initial'),
        ('people', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Claim',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('kind', models.CharField(choices=[('report', 'Reporte'), ('complaint', 'Reclamo')], max_length=10)),
                ('title', models.CharField(max_length=120)),
                ('status', models.CharField(choices=[('pending', 'Recibido'), ('in_progress', 'En proceso'), ('resolved', 'Resuelto')], default='pending', max_length=12)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='claims', to='people.person')),
                ('building', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='claims', to='buildings.building')),
                ('unit', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='claims', to='buildings.unit')),
            ],
            options={
                'indexes': [
                    models.Index(fields=['building', 'status'], name='communicati_buildin_cf3785_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='Notice',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('title', models.CharField(max_length=120)),
                ('body', models.TextField()),
                ('building', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='notices', to='buildings.building')),
                ('published_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['building', 'created_at'], name='communicati_buildin_151e6a_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='Task',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('text', models.CharField(max_length=90)),
                ('due_date', models.DateField(blank=True, null=True)),
                ('done', models.BooleanField(default=False)),
                ('building', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='tasks', to='buildings.building')),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='tasks', to='accounts.organization')),
            ],
            options={
                'indexes': [
                    models.Index(fields=['organization', 'done'], name='communicati_organiz_2cadfd_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='ClaimMessage',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('from_admin', models.BooleanField(default=False)),
                ('text', models.TextField()),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('claim', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='messages', to='communications.claim')),
            ],
            options={
                'ordering': ['created_at'],
            },
        ),
        migrations.RunSQL(APPEND_ONLY_SQL, APPEND_ONLY_REVERSE_SQL),
        AuditTrigger('communications_notice'),
        AuditTrigger('communications_claim'),
        AuditTrigger('communications_claimmessage'),
        AuditTrigger('communications_task'),
    ]
