import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('people', '0001_initial'),
        ('settlements', '0001_initial'),
        ('buildings', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='LedgerEntry',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('date', models.DateField()),
                ('kind', models.CharField(choices=[('opening', 'Apertura'), ('charge', 'Cargo'), ('payment', 'Pago'), ('adjustment', 'Ajuste'), ('surcharge', 'Recargo')], max_length=12)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('description', models.CharField(blank=True, max_length=255)),
                ('base_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('coefficient', models.DecimalField(blank=True, decimal_places=6, max_digits=7, null=True)),
                ('days', models.SmallIntegerField(blank=True, null=True)),
                ('days_in_month', models.SmallIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('adjusts', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='adjustments', to='ledger.ledgerentry')),
                ('concept', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='buildings.expenseconcept')),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('occupancy', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='entries', to='people.occupancy')),
                ('settlement', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='entries', to='settlements.settlement')),
            ],
            options={'ordering': ['date', 'created_at']},
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=~Q(('amount', 0)), name='ledger_entry_amount_nonzero'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=~Q(('kind', 'charge')) | (Q(('amount__gt', 0), ('settlement__isnull', False), ('concept__isnull', False), ('base_amount__isnull', False), ('coefficient__isnull', False), ('days__isnull', False), ('days_in_month__isnull', False))), name='ledger_charge_fields_valid'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=~Q(('kind', 'payment')) | Q(('amount__lt', 0)), name='ledger_payment_negative'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=~Q(('kind', 'surcharge')) | Q(('amount__gt', 0)), name='ledger_surcharge_positive'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=~Q(('kind', 'adjustment')) | Q(('adjusts__isnull', False)), name='ledger_adjustment_target_required'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=Q(('days__isnull', True)) | (Q(('days__gte', 1), ('days__lte', models.F('days_in_month')))), name='ledger_days_in_month_range'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(condition=Q(('days_in_month__isnull', True)) | (Q(('days_in_month__gte', 28), ('days_in_month__lte', 31))), name='ledger_days_in_month_valid'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.UniqueConstraint(condition=Q(('kind', 'charge')), fields=('occupancy', 'settlement', 'concept'), name='ledger_one_charge_per_settlement_concept'),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.UniqueConstraint(condition=Q(('kind', 'opening')), fields=('occupancy',), name='ledger_one_opening_per_occupancy'),
        ),
        migrations.AddIndex(
            model_name='ledgerentry',
            index=models.Index(fields=['occupancy', 'date'], name='ledger_occupancy_date_idx'),
        ),
    ]
