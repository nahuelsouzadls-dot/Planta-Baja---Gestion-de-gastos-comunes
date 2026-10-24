from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.accounts.models import Organization

from .models import Building, ExpenseConcept


DEFAULT_CONCEPTS = [
    ('O.S.E. (agua)', ExpenseConcept.Kind.ORDINARY, False),
    ('U.T.E. (luz)', ExpenseConcept.Kind.ORDINARY, False),
    ('Limpieza', ExpenseConcept.Kind.ORDINARY, False),
    ('Honorarios de administración', ExpenseConcept.Kind.ORDINARY, False),
    ('Fondo de reserva', ExpenseConcept.Kind.OWNER_ONLY, True),
    ('Cuota extraordinaria', ExpenseConcept.Kind.OWNER_ONLY, False),
]


@transaction.atomic
def create_building(organization: Organization, **datos) -> Building:
    building = Building.objects.create(organization=organization, **datos)
    ExpenseConcept.objects.bulk_create(
        [
            ExpenseConcept(
                building=building,
                name=name,
                kind=kind,
                is_reserve_fund=is_reserve_fund,
                order=order,
            )
            for order, (name, kind, is_reserve_fund) in enumerate(DEFAULT_CONCEPTS, start=1)
        ]
    )
    return building


def coefficient_sum(building: Building) -> Decimal:
    return sum(
        building.units.values_list('coefficient', flat=True),
        Decimal('0'),
    )


def validate_coefficients(building: Building) -> None:
    total = coefficient_sum(building)
    if total != Decimal('1'):
        raise ValidationError(
            f'Los coeficientes del edificio suman {total}; deben sumar exactamente 1.'
        )
