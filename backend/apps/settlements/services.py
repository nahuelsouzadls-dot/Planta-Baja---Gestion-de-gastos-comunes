import calendar
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.buildings.models import Building, ExpenseConcept

from .models import Settlement, SettlementItem


def first_day(value: date) -> date:
    return value.replace(day=1)


def _month_label(month: date) -> str:
    months = (
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    )
    return f'{months[month.month - 1].capitalize()} {month.year}'


@transaction.atomic
def save_draft(
    building: Building,
    month: date,
    items: dict[ExpenseConcept, Decimal],
    *,
    details: dict[ExpenseConcept, str] | None = None,
) -> Settlement:
    normalized_month = first_day(month)
    details = details or {}

    for concept, amount in items.items():
        if isinstance(amount, float):
            raise TypeError('Los montos deben ser Decimal, no float.')
        if not isinstance(amount, Decimal):
            raise TypeError('Los montos deben ser Decimal.')
        if amount < 0:
            raise ValidationError('Los montos no pueden ser negativos.')
        if concept.building_id != building.id:
            raise ValidationError('Todos los conceptos deben pertenecer al mismo edificio.')
        if not concept.is_active:
            raise ValidationError(f'El concepto "{concept}" está inactivo.')

    total = sum((amount for amount in items.values()), Decimal('0'))
    if total <= 0:
        raise ValidationError('La liquidación debe tener un total mayor que cero.')

    for concept, amount in items.items():
        if (
            amount > 0
            and concept.kind == ExpenseConcept.Kind.OWNER_ONLY
            and not concept.is_reserve_fund
            and not details.get(concept, '').strip()
        ):
            raise ValidationError(f'El concepto "{concept}" requiere un detalle.')

    settlement = (
        Settlement.objects.select_for_update()
        .filter(building=building, month=normalized_month)
        .first()
    )
    if settlement is not None and settlement.status == Settlement.Status.ISSUED:
        raise ValidationError(f'La liquidación de {_month_label(normalized_month)} ya fue emitida.')

    if settlement is None:
        settlement = Settlement.objects.create(
            building=building,
            month=normalized_month,
            status=Settlement.Status.DRAFT,
        )
    else:
        settlement.items.all().delete()

    SettlementItem.objects.bulk_create(
        [
            SettlementItem(
                settlement=settlement,
                concept=concept,
                amount=amount,
                detail=details.get(concept, '').strip(),
            )
            for concept, amount in items.items()
            if amount > 0
        ]
    )
    return settlement


@transaction.atomic
def delete_draft(settlement: Settlement) -> None:
    locked = Settlement.objects.select_for_update().get(pk=settlement.pk)
    if locked.status != Settlement.Status.DRAFT:
        raise ValidationError('Solo se pueden borrar liquidaciones en borrador.')
    deleted, _ = Settlement.objects.filter(
        pk=locked.pk,
        status=Settlement.Status.DRAFT,
    ).delete()
    if deleted == 0:
        raise RuntimeError('No se pudo borrar la liquidación en borrador.')


def settlement_total(settlement: Settlement) -> Decimal:
    return sum(
        settlement.items.values_list('amount', flat=True),
        Decimal('0'),
    )
