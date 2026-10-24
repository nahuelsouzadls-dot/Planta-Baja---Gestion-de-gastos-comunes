import calendar
from datetime import date, timedelta

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q

from apps.accounts.models import Organization
from apps.buildings.models import Unit
from apps.audit.context import audit_context
from apps.ledger.payments import assert_member
from apps.ledger.services import balance

from .models import Occupancy, Person


@transaction.atomic
def create_person(
    organization: Organization,
    *,
    first_name: str,
    last_name: str,
    email: str = '',
    phone: str = '',
    document: str = '',
) -> Person:
    return Person.objects.create(
        organization=organization,
        first_name=first_name,
        last_name=last_name,
        email=email,
        phone=phone,
        document=document,
    )


@transaction.atomic
def move_in(
    unit: Unit,
    person: Person,
    role: str,
    start_date: date,
) -> Occupancy:
    if person.organization_id != unit.building.organization_id:
        raise ValidationError(
            'La persona y la unidad deben pertenecer a la misma organización.'
        )

    try:
        with transaction.atomic():
            return Occupancy.objects.create(
                unit=unit,
                person=person,
                role=role,
                start_date=start_date,
            )
    except IntegrityError as error:
        if 'occupancy_no_overlap' not in str(error).lower():
            raise
        raise ValidationError(
            f'La unidad {unit.number} ya tiene {dict(Occupancy.Role.choices).get(role, role).lower()} '
            'en esas fechas.'
        ) from error


@transaction.atomic
def move_out(occupancy: Occupancy, end_date: date) -> Occupancy:
    if occupancy.role != Occupancy.Role.TENANT:
        raise ValidationError(
            'Un propietario no se muda; la ocupación se cierra mediante una venta.'
        )
    if occupancy.end_date is not None:
        raise ValidationError('La ocupación ya está cerrada.')
    if end_date < occupancy.start_date:
        raise ValidationError('La fecha de salida no puede ser anterior a la fecha de inicio.')

    occupancy.end_date = end_date
    occupancy.save(update_fields=['end_date', 'updated_at'])
    return occupancy


def current_occupancy(
    unit: Unit,
    role: str,
    on_date: date,
) -> Occupancy | None:
    return (
        Occupancy.objects.filter(
            unit=unit,
            role=role,
            start_date__lte=on_date,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .first()
    )


def days_in_month(occupancy: Occupancy, month: date) -> int:
    month_end = date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])
    if occupancy.start_date > month_end:
        return 0
    if occupancy.end_date is not None and occupancy.end_date < month:
        return 0

    overlap_start = max(occupancy.start_date, month)
    overlap_end = min(occupancy.end_date or month_end, month_end)
    return max(0, (overlap_end - overlap_start).days + 1)


def occupancies_in_month(
    unit: Unit,
    month: date,
) -> list[tuple[Occupancy, int]]:
    month_end = date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])
    occupancies = (
        Occupancy.objects.filter(
            unit=unit,
            start_date__lte=month_end,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=month))
        .order_by('role', 'start_date')
    )
    return [(occupancy, days_in_month(occupancy, month)) for occupancy in occupancies]


def owner_gaps(unit: Unit, month: date) -> int:
    total_days = calendar.monthrange(month.year, month.month)[1]
    owner_days = sum(
        occupied_days
        for occupancy, occupied_days in occupancies_in_month(unit, month)
        if occupancy.role == Occupancy.Role.OWNER
    )
    return max(0, total_days - owner_days)


@transaction.atomic
def sell_unit(unit: Unit, buyer: Person, sale_date: date, user) -> Occupancy:
    organization = unit.building.organization
    assert_member(user, organization)
    if buyer.organization_id != organization.id:
        raise ValidationError('El comprador y la unidad deben pertenecer a la misma organización.')

    seller_occupancy = (
        Occupancy.objects.select_for_update()
        .filter(
            unit=unit,
            role=Occupancy.Role.OWNER,
            start_date__lte=sale_date,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=sale_date))
        .first()
    )
    if seller_occupancy is None:
        raise ValidationError('La unidad no tiene propietario vigente en la fecha de venta.')
    seller_balance = balance(seller_occupancy)
    if seller_balance > 0:
        raise ValidationError(
            f'El vendedor tiene que estar al día para vender: debe $ {seller_balance:.2f}'
        )

    with audit_context(user, organization=organization):
        seller_occupancy.end_date = sale_date - timedelta(days=1)
        seller_occupancy.save(update_fields=['end_date', 'updated_at'])
        return Occupancy.objects.create(
            unit=unit,
            person=buyer,
            role=Occupancy.Role.OWNER,
            start_date=sale_date,
        )
