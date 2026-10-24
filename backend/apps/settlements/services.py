import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.buildings.models import Building, ExpenseConcept, Unit
from apps.buildings.services import validate_coefficients
from apps.core.money import to_money
from apps.core.money import format_money
from apps.ledger.models import LedgerEntry
from apps.people.models import Occupancy
from apps.people.services import owner_gaps

from .models import Settlement, SettlementItem

CENT = Decimal('0.01')


@dataclass(frozen=True)
class IssueSummary:
    charges_count: int
    total_distributed: Decimal
    rounding_differences: dict[str, Decimal]


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

    normalized_items = {}
    for concept, amount in items.items():
        amount = to_money(amount)
        if amount < 0:
            raise ValidationError('Los montos no pueden ser negativos.')
        if concept.building_id != building.id:
            raise ValidationError('Todos los conceptos deben pertenecer al mismo edificio.')
        if not concept.is_active:
            raise ValidationError(f'El concepto "{concept}" está inactivo.')
        normalized_items[concept] = amount

    total = sum(normalized_items.values(), Decimal('0'))
    if total <= 0:
        raise ValidationError('La liquidación debe tener un total mayor que cero.')

    for concept, amount in normalized_items.items():
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
            for concept, amount in normalized_items.items()
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


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _unit_sort_key(unit: Unit) -> tuple[int, int | str]:
    try:
        return (0, int(unit.number))
    except (TypeError, ValueError):
        return (1, unit.number)


def _responsible_occupancies(
    unit: Unit,
    month: date,
    days_in_month: int,
    concept_kind: str,
    occupancies: list[Occupancy] | None = None,
) -> dict[Occupancy, int]:
    month_end = date(
        month.year,
        month.month,
        calendar.monthrange(month.year, month.month)[1],
    )
    if occupancies is None:
        occupancies = list(
            Occupancy.objects.filter(
                unit=unit,
                start_date__lte=month_end,
            ).filter(Q(end_date__isnull=True) | Q(end_date__gte=month))
        )
    by_day: dict[Occupancy, int] = {}
    for day_number in range(1, days_in_month + 1):
        current = date(month.year, month.month, day_number)
        owner = next(
            (
                occupancy
                for occupancy in occupancies
                if occupancy.role == Occupancy.Role.OWNER
                and occupancy.start_date <= current
                and (occupancy.end_date is None or occupancy.end_date >= current)
            ),
            None,
        )
        if owner is None:
            continue
        responsible = owner
        if concept_kind == ExpenseConcept.Kind.ORDINARY:
            tenant = next(
                (
                    occupancy
                    for occupancy in occupancies
                    if occupancy.role == Occupancy.Role.TENANT
                    and occupancy.start_date <= current
                    and (occupancy.end_date is None or occupancy.end_date >= current)
                ),
                None,
            )
            responsible = tenant or owner
        by_day[responsible] = by_day.get(responsible, 0) + 1
    return by_day


@transaction.atomic
def issue_settlement(settlement: Settlement, user) -> IssueSummary:
    if user is None:
        raise ValueError('issued_by es obligatorio.')

    locked = (
        Settlement.objects.select_for_update()
        .select_related('building__organization')
        .get(pk=settlement.pk)
    )
    if locked.status != Settlement.Status.DRAFT:
        raise ValidationError('Solo se pueden emitir liquidaciones en borrador.')
    items = list(locked.items.select_related('concept').order_by('concept__order', 'pk'))
    if not items:
        raise ValidationError('La liquidación debe tener al menos un ítem.')

    building = locked.building
    with audit_context(user, organization=building.organization):
        validate_coefficients(building)
        units = list(building.units.all())
        gaps = [unit.number for unit in units if owner_gaps(unit, locked.month) > 0]
        if gaps:
            raise ValidationError(
                'Las unidades {} no tienen propietario todo el mes.'.format(
                    ' y '.join(gaps)
                )
            )

        days_count = calendar.monthrange(locked.month.year, locked.month.month)[1]
        entries: list[LedgerEntry] = []
        differences: dict[str, Decimal] = {}
        occupancies_by_unit = {
            unit.id: list(
                Occupancy.objects.filter(
                    unit=unit,
                    start_date__lte=date(
                        locked.month.year,
                        locked.month.month,
                        days_count,
                    ),
                ).filter(Q(end_date__isnull=True) | Q(end_date__gte=locked.month))
            )
            for unit in units
        }

        for item in items:
            candidates = []
            for unit in units:
                days_by_occupancy = _responsible_occupancies(
                    unit,
                    locked.month,
                    days_count,
                    item.concept.kind,
                    occupancies_by_unit[unit.id],
                )
                base = item.amount * unit.coefficient
                for occupancy, days in days_by_occupancy.items():
                    part = _round_money(base * days / days_count)
                    candidates.append({
                        'unit': unit,
                        'occupancy': occupancy,
                        'days': days,
                        'base': base,
                        'amount': part,
                    })

            distributed = sum(
                (candidate['amount'] for candidate in candidates),
                Decimal('0.00'),
            )
            difference = _round_money(item.amount - distributed)
            differences[item.concept.name] = difference
            if candidates:
                target = sorted(
                    candidates,
                    key=lambda candidate: (
                        -candidate['amount'],
                        _unit_sort_key(candidate['unit']),
                        0 if candidate['occupancy'].role == Occupancy.Role.OWNER else 1,
                    ),
                )[0]
                target['amount'] += difference

            for candidate in candidates:
                if candidate['amount'] <= 0:
                    continue
                entries.append(
                    LedgerEntry(
                        occupancy=candidate['occupancy'],
                        date=locked.month,
                        kind=LedgerEntry.Kind.CHARGE,
                        amount=candidate['amount'],
                        settlement=locked,
                        concept=item.concept,
                        created_by=user,
                        base_amount=_round_money(candidate['base']),
                        coefficient=candidate['unit'].coefficient,
                        days=candidate['days'],
                        days_in_month=days_count,
                    )
                )

        distributed_total = sum((entry.amount for entry in entries), Decimal('0.00'))
        expected_total = settlement_total(locked)
        if distributed_total != expected_total:
            raise RuntimeError(
                'La suma de los cargos creados no coincide con el total de la liquidación.'
            )
        LedgerEntry.objects.bulk_create(entries)
        locked.status = Settlement.Status.ISSUED
        locked.issued_at = timezone.now()
        locked.issued_by = user
        locked.save(update_fields=['status', 'issued_at', 'issued_by', 'updated_at'])
        record_event(
            user,
            building.organization,
            'settlement.issue',
            locked,
            (
                f'Emitió la liquidación de {_month_label(locked.month)} de {building.name} '
                f'por {format_money(expected_total)} ({len(entries)} '
                f'{"cargo" if len(entries) == 1 else "cargos"})'
            ),
            month=locked.month.isoformat(),
            total=str(expected_total),
            charges_count=len(entries),
        )

    return IssueSummary(
        charges_count=len(entries),
        total_distributed=sum((entry.amount for entry in entries), Decimal('0.00')),
        rounding_differences=differences,
    )
