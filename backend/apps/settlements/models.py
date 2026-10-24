from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.buildings.models import Building, ExpenseConcept
from apps.core.models import TimeStampedModel


class Settlement(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Borrador'
        ISSUED = 'issued', 'Emitida'

    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='settlements',
    )
    month = models.DateField()
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    issued_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='+',
    )

    class Meta:
        ordering = ['-month']
        constraints = [
            models.UniqueConstraint(
                fields=['building', 'month'],
                name='settlement_building_month_unique',
            ),
            models.CheckConstraint(
                condition=models.Q(month__day=1),
                name='settlement_month_first_day',
            ),
            models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ('issued_at__isnull', False),
                        ('issued_by__isnull', False),
                        ('status', 'issued'),
                    )
                    | models.Q(
                        ('issued_at__isnull', True),
                        ('issued_by__isnull', True),
                        ('status', 'draft'),
                    )
                ),
                name='settlement_status_issue_fields',
            ),
        ]

    def __str__(self):
        return f'{self.building} - {self.month:%m/%Y}'


class SettlementItem(TimeStampedModel):
    settlement = models.ForeignKey(
        Settlement,
        on_delete=models.CASCADE,
        related_name='items',
    )
    concept = models.ForeignKey(
        ExpenseConcept,
        on_delete=models.PROTECT,
        related_name='+',
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    detail = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['concept__order']
        constraints = [
            models.UniqueConstraint(
                fields=['settlement', 'concept'],
                name='settlement_item_settlement_concept_unique',
            ),
            models.CheckConstraint(
                condition=models.Q(amount__gte=0),
                name='settlement_item_amount_nonnegative',
            ),
        ]

    def __str__(self):
        return f'{self.settlement} - {self.concept}'
