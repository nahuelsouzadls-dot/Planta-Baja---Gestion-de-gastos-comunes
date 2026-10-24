from decimal import Decimal

from django.db import models
from django.db.models import Q

from apps.accounts.models import Organization
from apps.core.models import TimeStampedModel


class Building(TimeStampedModel):
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name='buildings',
    )
    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300)
    neighborhood = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, default='Montevideo')
    bank_name = models.CharField(max_length=100, blank=True)
    bank_account = models.CharField(max_length=50, blank=True)
    bank_holder = models.CharField(max_length=200, blank=True)
    due_day = models.PositiveSmallIntegerField(default=10)
    reserve_opening = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
    )
    opening_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.CheckConstraint(
                condition=Q(due_day__gte=1) & Q(due_day__lte=28),
                name='building_due_day_1_28',
            ),
        ]

    def __str__(self):
        return self.name


class Unit(TimeStampedModel):
    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='units',
    )
    number = models.CharField(max_length=20)
    floor = models.SmallIntegerField()
    coefficient = models.DecimalField(max_digits=7, decimal_places=6)
    receives_paper = models.BooleanField(default=False)

    class Meta:
        ordering = ['floor', 'number']
        constraints = [
            models.UniqueConstraint(
                fields=['building', 'number'],
                name='unit_building_number_unique',
            ),
            models.CheckConstraint(
                condition=Q(coefficient__gt=0) & Q(coefficient__lte=1),
                name='unit_coefficient_0_1',
            ),
        ]

    def __str__(self):
        return self.number


class ExpenseConcept(TimeStampedModel):
    class Kind(models.TextChoices):
        ORDINARY = 'ordinary', 'Ordinario'
        OWNER_ONLY = 'owner_only', 'Solo propietario'

    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='concepts',
    )
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    is_reserve_fund = models.BooleanField(default=False)
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['order', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['building', 'name'],
                name='expense_concept_building_name_unique',
            ),
            models.UniqueConstraint(
                fields=['building'],
                condition=Q(is_reserve_fund=True),
                name='one_reserve_fund_per_building',
            ),
            models.CheckConstraint(
                condition=Q(is_reserve_fund=False) | Q(kind='owner_only'),
                name='reserve_fund_owner_only',
            ),
        ]

    def __str__(self):
        return self.name
