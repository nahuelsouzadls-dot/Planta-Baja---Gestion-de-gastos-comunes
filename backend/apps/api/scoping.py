from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db.models import DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.accounts.models import Organization, OrgMembership
from apps.buildings.models import Building
from apps.people.models import Occupancy


def employee_organizations(user):
    return Organization.objects.filter(
        memberships__user=user,
    ).distinct().order_by('name', 'pk')


def employee_buildings(user):
    return Building.objects.filter(
        organization__in=employee_organizations(user),
    ).distinct()


def resident_occupancies(user, on_date=None):
    on_date = on_date or timezone.localdate()
    balance_field = DecimalField(max_digits=12, decimal_places=2)
    return (
        Occupancy.objects.filter(
            person__user=user,
        )
        .annotate(
            balance=Coalesce(
                Sum('entries__amount'),
                Value(Decimal('0.00')),
                output_field=balance_field,
            ),
        )
        .filter(
            Q(start_date__lte=on_date)
            & (
                Q(end_date__isnull=True)
                | Q(end_date__gte=on_date)
                | Q(end_date__lt=on_date, balance__gt=Decimal('0.00'))
            ),
        )
        .order_by('unit_id', 'role', 'start_date', 'pk')
    )


def resident_buildings(user, on_date=None):
    return Building.objects.filter(
        units__occupancies__in=resident_occupancies(user, on_date),
    ).distinct()


def get_in_scope_or_404(queryset, pk):
    try:
        return get_object_or_404(queryset, pk=pk)
    except (ValidationError, ValueError, TypeError) as exc:
        raise Http404 from exc

