from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.buildings.models import ExpenseConcept
from apps.core.models import TimeStampedModel, UUIDModel
from apps.people.models import Occupancy
from apps.settlements.models import Settlement


class LedgerEntry(UUIDModel):
    class Kind(models.TextChoices):
        OPENING = 'opening', 'Apertura'
        CHARGE = 'charge', 'Cargo'
        PAYMENT = 'payment', 'Pago'
        ADJUSTMENT = 'adjustment', 'Ajuste'
        SURCHARGE = 'surcharge', 'Recargo'

    occupancy = models.ForeignKey(Occupancy, on_delete=models.PROTECT, related_name='entries')
    date = models.DateField()
    kind = models.CharField(max_length=12, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    settlement = models.ForeignKey(
        Settlement, null=True, blank=True, on_delete=models.PROTECT, related_name='entries'
    )
    concept = models.ForeignKey(
        ExpenseConcept, null=True, blank=True, on_delete=models.PROTECT, related_name='+'
    )
    receipt = models.ForeignKey(
        'Receipt', null=True, blank=True, on_delete=models.PROTECT, related_name='payments'
    )
    adjusts = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.PROTECT, related_name='adjustments'
    )
    description = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    base_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    coefficient = models.DecimalField(max_digits=7, decimal_places=6, null=True, blank=True)
    days = models.SmallIntegerField(null=True, blank=True)
    days_in_month = models.SmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date', 'created_at']
        constraints = [
            models.CheckConstraint(condition=~Q(amount=0), name='ledger_entry_amount_nonzero'),
            models.CheckConstraint(
                condition=~Q(kind='charge') | (
                    Q(amount__gt=0) & Q(settlement__isnull=False) & Q(concept__isnull=False)
                    & Q(base_amount__isnull=False) & Q(coefficient__isnull=False)
                    & Q(days__isnull=False) & Q(days_in_month__isnull=False)
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
                | (Q(days_in_month__gte=28) & Q(days_in_month__lte=31)),
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
            models.CheckConstraint(
                condition=Q(receipt__isnull=True) | Q(kind='payment'),
                name='ledger_receipt_only_payment',
            ),
        ]
        indexes = [models.Index(fields=['occupancy', 'date'], name='ledger_occupancy_date_idx')]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('LedgerEntry es append-only y no se puede modificar.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('LedgerEntry es append-only y no se puede borrar.')

    def __str__(self):
        return f'{self.occupancy} - {self.date} - {self.amount}'


class Receipt(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pendiente'
        APPROVED = 'approved', 'Aprobado'
        REJECTED = 'rejected', 'Rechazado'

    CONTENT_TYPES = (
        ('image/jpeg', 'JPEG'),
        ('image/png', 'PNG'),
        ('image/heic', 'HEIC'),
        ('image/webp', 'WebP'),
        ('application/pdf', 'PDF'),
    )

    person = models.ForeignKey('people.Person', on_delete=models.PROTECT, related_name='receipts')
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+'
    )
    file_key = models.CharField(max_length=100, unique=True)
    file_sha256 = models.CharField(max_length=64)
    content_type = models.CharField(max_length=50, choices=CONTENT_TYPES)
    size_bytes = models.PositiveIntegerField()
    declared_amount = models.DecimalField(max_digits=12, decimal_places=2)
    transfer_date = models.DateField()
    note = models.TextField(blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='+'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(declared_amount__gt=0), name='receipt_declared_amount_positive'
            ),
            models.CheckConstraint(
                condition=Q(size_bytes__gte=1) & Q(size_bytes__lte=10485760),
                name='receipt_size_valid',
            ),
            models.CheckConstraint(
                condition=(
                    Q(status='pending', reviewed_by__isnull=True, reviewed_at__isnull=True)
                    | Q(status='approved', reviewed_by__isnull=False, reviewed_at__isnull=False)
                    | Q(status='rejected', reviewed_by__isnull=False, reviewed_at__isnull=False)
                ),
                name='receipt_review_fields_valid',
            ),
            models.CheckConstraint(
                condition=~Q(status='rejected') | ~Q(rejection_reason=''),
                name='receipt_rejection_reason_required',
            ),
        ]
        indexes = [models.Index(fields=['status', 'created_at'], name='receipt_status_created_idx')]

    def delete(self, *args, **kwargs):
        raise ValidationError('Los comprobantes no se pueden borrar.')


class ReceiptAllocation(TimeStampedModel):
    receipt = models.ForeignKey(Receipt, on_delete=models.PROTECT, related_name='allocations')
    occupancy = models.ForeignKey(Occupancy, on_delete=models.PROTECT, related_name='+')
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['receipt', 'occupancy'], name='receipt_allocation_unique'
            ),
            models.CheckConstraint(
                condition=Q(amount__gt=0), name='receipt_allocation_amount_positive'
            ),
        ]
