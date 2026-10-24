from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.accounts.models import Organization
from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.ledger.payments import assert_member

from .models import Building, ExpenseConcept, Unit


DEFAULT_CONCEPTS = [
    ('O.S.E. (agua)', ExpenseConcept.Kind.ORDINARY, False),
    ('U.T.E. (luz)', ExpenseConcept.Kind.ORDINARY, False),
    ('Limpieza', ExpenseConcept.Kind.ORDINARY, False),
    ('Honorarios de administración', ExpenseConcept.Kind.ORDINARY, False),
    ('Fondo de reserva', ExpenseConcept.Kind.OWNER_ONLY, True),
    ('Cuota extraordinaria', ExpenseConcept.Kind.OWNER_ONLY, False),
]


@transaction.atomic
def create_building(organization: Organization, user, **datos) -> Building:
    assert_member(user, organization)
    with audit_context(user, organization=organization):
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
        record_event(
            user,
            organization,
            'building.create',
            building,
            f'Creó el edificio {building.name}',
            name=building.name,
        )
        return building


@transaction.atomic
def add_unit(
    building: Building,
    user,
    *,
    number,
    floor,
    coefficient,
    receives_paper=False,
) -> Unit:
    assert_member(user, building.organization)
    if isinstance(coefficient, float):
        raise ValidationError('El coeficiente debe ser Decimal, no float.')
    try:
        coefficient = Decimal(str(coefficient))
    except (TypeError, ValueError, ArithmeticError) as error:
        raise ValidationError('El coeficiente debe ser un Decimal válido.') from error
    if coefficient != coefficient.quantize(Decimal('0.000001')):
        raise ValidationError('El coeficiente no puede tener más de 6 decimales.')
    if coefficient <= 0 or coefficient > 1:
        raise ValidationError('El coeficiente debe estar entre 0 y 1.')
    with audit_context(user, organization=building.organization):
        try:
            unit = Unit.objects.create(
                building=building,
                number=number,
                floor=floor,
                coefficient=coefficient,
                receives_paper=receives_paper,
            )
        except IntegrityError as error:
            if 'unit_building_number_unique' not in str(error).lower():
                raise
            raise ValidationError(
                f'La unidad {number} ya existe en el edificio.'
            ) from error
        record_event(
            user,
            building.organization,
            'unit.create',
            unit,
            f'Agregó la unidad {unit.number} en {building.name}',
            unit=unit.number,
            building=building.name,
        )
        return unit


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
