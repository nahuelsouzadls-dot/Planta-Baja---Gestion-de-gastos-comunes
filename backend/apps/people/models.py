from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeBoundary, RangeOperators
from django.db import models
from django.db.models import F, Func, Q
from django.db.models.functions import Lower

from apps.accounts.models import Organization
from apps.buildings.models import Unit
from apps.core.models import TimeStampedModel


class DateRange(Func):
    function = 'DATERANGE'
    output_field = DateRangeField()

    def __init__(self, start, end, boundary, **extra):
        super().__init__(start, end, boundary, **extra)


class Person(TimeStampedModel):
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name='people',
    )
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    document = models.CharField(max_length=20, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='people',
    )

    class Meta:
        ordering = ['last_name', 'first_name']
        constraints = [
            models.UniqueConstraint(
                Lower('email'),
                'organization',
                condition=~Q(email=''),
                name='person_email_unique_per_org',
            ),
        ]

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.first_name} {self.last_name}'


class Occupancy(TimeStampedModel):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Propietario'
        TENANT = 'tenant', 'Inquilino'

    unit = models.ForeignKey(
        Unit,
        on_delete=models.PROTECT,
        related_name='occupancies',
    )
    person = models.ForeignKey(
        Person,
        on_delete=models.PROTECT,
        related_name='occupancies',
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['unit', 'role', 'start_date']
        constraints = [
            models.CheckConstraint(
                condition=Q(end_date__isnull=True) | Q(end_date__gte=F('start_date')),
                name='occupancy_end_after_start',
            ),
            ExclusionConstraint(
                name='occupancy_no_overlap',
                expressions=[
                    ('unit', RangeOperators.EQUAL),
                    ('role', RangeOperators.EQUAL),
                    (
                        DateRange(
                            'start_date',
                            'end_date',
                            RangeBoundary(inclusive_lower=True, inclusive_upper=True),
                        ),
                        RangeOperators.OVERLAPS,
                    ),
                ],
                index_type='GIST',
            ),
        ]

    def __str__(self):
        return f'{self.person} - {self.unit} ({self.get_role_display()})'
