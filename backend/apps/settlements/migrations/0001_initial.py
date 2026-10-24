import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('buildings', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Settlement',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('month', models.DateField()),
                ('status', models.CharField(choices=[('draft', 'Borrador'), ('issued', 'Emitida')], default='draft', max_length=10)),
                ('issued_at', models.DateTimeField(blank=True, null=True)),
                ('building', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='settlements', to='buildings.building')),
                ('issued_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-month'],
            },
        ),
        migrations.CreateModel(
            name='SettlementItem',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('detail', models.CharField(blank=True, max_length=200)),
                ('concept', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='buildings.expenseconcept')),
                ('settlement', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='settlements.settlement')),
            ],
            options={
                'ordering': ['concept__order'],
            },
        ),
        migrations.AddConstraint(
            model_name='settlement',
            constraint=models.UniqueConstraint(fields=('building', 'month'), name='settlement_building_month_unique'),
        ),
        migrations.AddConstraint(
            model_name='settlement',
            constraint=models.CheckConstraint(condition=Q(('month__day', 1)), name='settlement_month_first_day'),
        ),
        migrations.AddConstraint(
            model_name='settlement',
            constraint=models.CheckConstraint(
                condition=Q(
                    Q(('issued_at__isnull', False), ('issued_by__isnull', False), ('status', 'issued'))
                    | Q(('issued_at__isnull', True), ('issued_by__isnull', True), ('status', 'draft'))
                ),
                name='settlement_status_issue_fields',
            ),
        ),
        migrations.AddConstraint(
            model_name='settlementitem',
            constraint=models.UniqueConstraint(fields=('settlement', 'concept'), name='settlement_item_settlement_concept_unique'),
        ),
        migrations.AddConstraint(
            model_name='settlementitem',
            constraint=models.CheckConstraint(condition=Q(('amount__gte', 0)), name='settlement_item_amount_nonnegative'),
        ),
    ]
