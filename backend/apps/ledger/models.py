import uuid

from django.db import models


class Movement(models.Model):
    class MovementType(models.TextChoices):
        CHARGE = 'charge', 'Cargo'
        PAYMENT = 'payment', 'Pago'
        ADJUSTMENT = 'adjustment', 'Ajuste'
        OPENING = 'opening', 'Apertura'

    class PaymentStatus(models.TextChoices):
        PENDING = 'pending', 'Pendiente'
        COMPLETED = 'completed', 'Completado'
        REJECTED = 'rejected', 'Rechazado'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    resident = models.ForeignKey(
        'residents.Resident',
        on_delete=models.PROTECT,
        related_name='movements',
    )
    date = models.DateField()
    movement_type = models.CharField(max_length=20, choices=MovementType.choices)
    # Negative = debt (charge), positive = payment/credit.
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_status = models.CharField(
        max_length=10,
        choices=PaymentStatus.choices,
        null=True,
        blank=True,
    )
    bank_receipt_url = models.URLField(null=True, blank=True)
    notes = models.TextField(blank=True)
    monthly_expense = models.ForeignKey(
        'expenses.MonthlyExpense',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='movements',
    )
    # No updated_at — movements are immutable.
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-created_at']

    def __str__(self):
        return f"{self.get_movement_type_display()} {self.amount} UYU — {self.resident} ({self.date})"

    def save(self, *args, **kwargs):
        if self.pk and Movement.objects.filter(pk=self.pk).exists():
            raise ValueError(
                "Los movimientos son inmutables. Crea un asiento de ajuste."
            )
        super().save(*args, **kwargs)
