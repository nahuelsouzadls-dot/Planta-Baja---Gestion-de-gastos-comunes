import uuid
from decimal import Decimal

from django.db import models


class MonthlyExpense(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    building = models.ForeignKey(
        'buildings.Building',
        on_delete=models.PROTECT,
        related_name='monthly_expenses',
    )
    # Always stored as the first day of the month.
    billing_month = models.DateField()

    ose_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    ute_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    cleaning_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    fees_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    extraordinary_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    reserve_fund_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))

    is_generated = models.BooleanField(default=False)
    generated_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('building', 'billing_month')
        ordering = ['-billing_month']

    def __str__(self):
        return f"{self.building.name} — {self.billing_month.strftime('%Y-%m')}"

    @property
    def total_ordinary(self):
        return self.ose_total + self.ute_total + self.cleaning_total + self.fees_total

    @property
    def total_all(self):
        return self.total_ordinary + self.extraordinary_total + self.reserve_fund_total
