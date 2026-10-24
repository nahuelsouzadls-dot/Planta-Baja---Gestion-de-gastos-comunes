from django.db import migrations, models
from django.db.models import F, Q


class Migration(migrations.Migration):
    dependencies = [('ledger', '0003_receipts_and_payments')]

    operations = [
        migrations.RemoveConstraint(
            model_name='ledgerentry',
            name='ledger_charge_fields_valid',
        ),
        migrations.RemoveConstraint(
            model_name='ledgerentry',
            name='ledger_adjustment_target_required',
        ),
        migrations.RemoveConstraint(
            model_name='ledgerentry',
            name='ledger_days_in_month_range',
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(
                condition=Q(kind__in=('opening', 'charge', 'payment', 'adjustment', 'surcharge')),
                name='ledger_kind_valid',
            ),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(
                condition=~Q(kind='charge') | (
                    Q(amount__gt=0)
                    & Q(settlement__isnull=False)
                    & Q(concept__isnull=False)
                    & Q(base_amount__gt=0)
                    & Q(coefficient__gt=0)
                    & Q(coefficient__lte=1)
                    & Q(days__isnull=False)
                    & Q(days_in_month__isnull=False)
                ),
                name='ledger_charge_fields_valid',
            ),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(
                condition=Q(kind='charge') | Q(
                    settlement__isnull=True,
                    concept__isnull=True,
                    base_amount__isnull=True,
                    coefficient__isnull=True,
                    days__isnull=True,
                    days_in_month__isnull=True,
                ),
                name='ledger_charge_fields_only_charge',
            ),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(
                condition=(
                    (Q(kind='adjustment') & Q(adjusts__isnull=False))
                    | (~Q(kind='adjustment') & Q(adjusts__isnull=True))
                ),
                name='ledger_adjustment_target_exclusive',
            ),
        ),
        migrations.AddConstraint(
            model_name='ledgerentry',
            constraint=models.CheckConstraint(
                condition=(
                    Q(days__isnull=True, days_in_month__isnull=True)
                    | (
                        Q(days__isnull=False, days_in_month__isnull=False)
                        & Q(days__gte=1)
                        & Q(days__lte=F('days_in_month'))
                    )
                ),
                name='ledger_days_in_month_range',
            ),
        ),
    ]
