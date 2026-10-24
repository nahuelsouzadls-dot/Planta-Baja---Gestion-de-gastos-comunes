import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q

from apps.audit.operations import AuditTrigger


class Migration(migrations.Migration):
    dependencies = [
        ('audit', '0001_initial'),
        ('ledger', '0002_append_only'),
        ('people', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Receipt',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('file_key', models.CharField(max_length=100, unique=True)),
                ('file_sha256', models.CharField(max_length=64)),
                ('content_type', models.CharField(
                    choices=[
                        ('image/jpeg', 'JPEG'), ('image/png', 'PNG'), ('image/heic', 'HEIC'),
                        ('image/webp', 'WebP'), ('application/pdf', 'PDF'),
                    ],
                    max_length=50,
                )),
                ('size_bytes', models.PositiveIntegerField()),
                ('declared_amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('transfer_date', models.DateField()),
                ('note', models.TextField(blank=True)),
                ('status', models.CharField(
                    choices=[
                        ('pending', 'Pendiente'), ('approved', 'Aprobado'), ('rejected', 'Rechazado'),
                    ],
                    default='pending',
                    max_length=8,
                )),
                ('rejection_reason', models.TextField(blank=True)),
                ('reviewed_at', models.DateTimeField(blank=True, null=True)),
                ('person', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='receipts',
                    to='people.person',
                )),
                ('reviewed_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('uploaded_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'indexes': [models.Index(fields=['status', 'created_at'], name='receipt_status_created_idx')],
            },
        ),
        migrations.CreateModel(
            name='ReceiptAllocation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('occupancy', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='+',
                    to='people.occupancy',
                )),
                ('receipt', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='allocations',
                    to='ledger.receipt',
                )),
            ],
        ),
        migrations.AddField(
            model_name='ledgerentry',
            name='receipt',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='payments',
                to='ledger.receipt',
            ),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(
                condition=Q(receipt__isnull=True) | Q(kind='payment'),
                name='ledger_receipt_only_payment',
            ),
        ),
        migrations.AddConstraint(
            model_name='receipt',
            constraint=models.CheckConstraint(
                condition=Q(declared_amount__gt=0),
                name='receipt_declared_amount_positive',
            ),
        ),
        migrations.AddConstraint(
            model_name='receipt',
            constraint=models.CheckConstraint(
                condition=Q(size_bytes__gte=1) & Q(size_bytes__lte=10485760),
                name='receipt_size_valid',
            ),
        ),
        migrations.AddConstraint(
            model_name='receipt',
            constraint=models.CheckConstraint(
                condition=(
                    Q(status='pending', reviewed_by__isnull=True, reviewed_at__isnull=True)
                    | Q(status='approved', reviewed_by__isnull=False, reviewed_at__isnull=False)
                    | Q(status='rejected', reviewed_by__isnull=False, reviewed_at__isnull=False)
                ),
                name='receipt_review_fields_valid',
            ),
        ),
        migrations.AddConstraint(
            model_name='receipt',
            constraint=models.CheckConstraint(
                condition=~Q(status='rejected') | ~Q(rejection_reason=''),
                name='receipt_rejection_reason_required',
            ),
        ),
        migrations.AddConstraint(
            model_name='receiptallocation',
            constraint=models.UniqueConstraint(
                fields=('receipt', 'occupancy'), name='receipt_allocation_unique'
            ),
        ),
        migrations.AddConstraint(
            model_name='receiptallocation',
            constraint=models.CheckConstraint(
                condition=Q(amount__gt=0), name='receipt_allocation_amount_positive'
            ),
        ),
        AuditTrigger('ledger_receipt'),
        AuditTrigger('ledger_receiptallocation'),
    ]
