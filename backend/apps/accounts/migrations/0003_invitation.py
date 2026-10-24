import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from apps.audit.operations import AuditTrigger


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0002_user_email_constraints'),
        ('audit', '0003_business_truncate_guards'),
        ('people', '0001_initial'),
    ]
    operations = [
        migrations.CreateModel(
            name='Invitation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('kind', models.CharField(choices=[('employee', 'Empleado'), ('resident', 'Residente')], max_length=10)),
                ('email', models.EmailField(max_length=254)),
                ('first_name', models.CharField(blank=True, max_length=150)),
                ('last_name', models.CharField(blank=True, max_length=150)),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('expires_at', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='created_invitations', to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='invitations', to='accounts.organization')),
                ('person', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='invitations', to='people.person')),
            ],
        ),
        migrations.AddConstraint(
            model_name='invitation',
            constraint=models.CheckConstraint(
                condition=models.Q(('kind', 'resident'), ('person__isnull', False)) | models.Q(('kind', 'employee'), ('person__isnull', True)),
                name='invitation_kind_person_consistent',
            ),
        ),
        AuditTrigger('accounts_invitation', exclude=['token_hash']),
    ]
