from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.buildings.models import ExpenseConcept
from apps.core.models import UUIDModel
from apps.people.models import Occupancy
from apps.settlements.models import Settlement


class LedgerEntry(UUIDModel):
    class Kind(models.TextChoices):
        OPENING = 'opening', 'Apertura'
        CHARGE = 'charge', 'Cargo'
        PAYMENT = 'payment', 'Pago'
        ADJUSTMENT = 'adjustment', 'Ajuste'
        SURCHARGE = 'surcharge', 'Recargo'

    occupancy = models.ForeignKey(
        Occupancy,
        on_delete=models.PROTECT,
        related_name='entries',
    )
    date = models.DateField()
    kind = models.CharField(max_length=12, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    settlement = models.ForeignKey(
        Settlement,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='entries',
    )
    concept = models.ForeignKey(
        ExpenseConcept,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='+',
    )
    adjusts = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='adjustments',
    )
    description = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='+',
    )
    base_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    coefficient = models.DecimalField(max_digits=7, decimal_places=6, null=True, blank=True)
    days = models.SmallIntegerField(null=True, blank=True)
    days_in_month = models.SmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'created_at']
        constraints = [
            models.CheckConstraint(
                condition=~Q(amount=0),
                name='ledger_entry_amount_nonzero',
            ),
            models.CheckConstraint(
                condition=~Q(kind='charge') | (
                    Q(amount__gt=0)
                    & Q(settlement__isnull=False)
                    & Q(concept__isnull=False)
                    & Q(base_amount__isnull=False)
                    & Q(coefficient__isnull=False)
                    & Q(days__isnull=False)
                    & Q(days_in_month__isnull=False)
                ),
                name='ledger_charge_fields_valid',
            ),
            models.CheckConstraint(
                condition=~Q(kind='payment') | Q(amount__lt=0),
                name='ledger_payment_negative',
            ),
            models.CheckConstraint(
                condition=~Q(kind='surcharge') | Q(amount__gt=0),
                name='ledger_surcharge_positive',
            ),
            models.CheckConstraint(
                condition=~Q(kind='adjustment') | Q(adjusts__isnull=False),
                name='ledger_adjustment_target_required',
            ),
            models.CheckConstraint(
                condition=Q(days__isnull=True)
                | (Q(days__gte=1) & Q(days__lte=models.F('days_in_month'))),
                name='ledger_days_in_month_range',
            ),
            models.CheckConstraint(
                condition=Q(days_in_month__isnull=True)
                | Q(days_in_month__gte=28) & Q(days_in_month__lte=31),
                name='ledger_days_in_month_valid',
            ),
            models.UniqueConstraint(
                fields=['occupancy', 'settlement', 'concept'],
                condition=Q(kind='charge'),
                name='ledger_one_charge_per_settlement_concept',
            ),
            models.UniqueConstraint(
                fields=['occupancy'],
                condition=Q(kind='opening'),
                name='ledger_one_opening_per_occupancy',
            ),
        ]
        indexes = [
            models.Index(fields=['occupancy', 'date'], name='ledger_occupancy_date_idx'),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('LedgerEntry es append-only y no se puede modificar.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('LedgerEntry es append-only y no se puede borrar.')

    def __str__(self):
        return f'{self.occupancy} - {self.date} - {self.amount}'
