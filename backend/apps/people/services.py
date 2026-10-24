import calendar
from datetime import date, timedelta

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q

from apps.accounts.models import Organization
from apps.audit.events import record_event
from apps.buildings.models import Unit
from apps.audit.context import audit_context
from apps.ledger.models import ReceiptAllocation
from apps.ledger.payments import assert_member
from apps.ledger.services import balance

from .models import Occupancy, Person

UNSET = object()


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


def move_in(
    unit: Unit,
    person: Person,
    role: str,
    start_date: date,
    user,
) -> Occupancy:
    organization = unit.building.organization
    assert_member(user, organization)
    if person.organization_id != unit.building.organization_id:
        raise ValidationError(
            'La persona y la unidad deben pertenecer a la misma organización.'
        )
    if role == Occupancy.Role.OWNER and current_occupancy(unit, role, start_date):
        raise ValidationError('El cambio de propietario debe hacerse mediante una venta.')

    with audit_context(user, organization=organization):
        try:
            with transaction.atomic():
                occupancy = Occupancy.objects.create(
                    unit=unit,
                    person=person,
                    role=role,
                    start_date=start_date,
                )
                record_event(
                    user,
                    organization,
                    'occupancy.move_in',
                    occupancy,
                    (
                        f'Dio de alta a {person} como '
                        f'{dict(Occupancy.Role.choices).get(role, role).lower()} '
                        f'del apto {unit.number} desde {start_date:%d/%m/%Y}'
                    ),
                    unit=unit.number,
                    person_id=str(person.id),
                    role=role,
                    start_date=start_date.isoformat(),
                )
                return occupancy
        except IntegrityError as error:
            if 'occupancy_no_overlap' not in str(error).lower():
                raise
            raise ValidationError(
                f'La unidad {unit.number} ya tiene {dict(Occupancy.Role.choices).get(role, role).lower()} '
                'en esas fechas.'
            ) from error


def move_out(occupancy: Occupancy, end_date: date, user) -> Occupancy:
    organization = occupancy.unit.building.organization
    assert_member(user, organization)
    with audit_context(user, organization=organization):
        with transaction.atomic():
            occupancy = Occupancy.objects.select_for_update().get(pk=occupancy.pk)
            if occupancy.role != Occupancy.Role.TENANT:
                raise ValidationError(
                    'Un propietario no se muda; la ocupación se cierra mediante una venta.'
                )
            if occupancy.end_date is not None:
                raise ValidationError('La ocupación ya está cerrada.')
            if end_date < occupancy.start_date:
                raise ValidationError(
                    'La fecha de salida no puede ser anterior a la fecha de inicio.'
                )

            occupancy.end_date = end_date
            occupancy.save(update_fields=['end_date', 'updated_at'])
            record_event(
                user,
                organization,
                'occupancy.move_out',
                occupancy,
                f'Dio de baja a {occupancy.person} del apto {occupancy.unit.number} desde {end_date:%d/%m/%Y}',
                unit=occupancy.unit.number,
                person_id=str(occupancy.person_id),
                end_date=end_date.isoformat(),
            )
            return occupancy


def replace_tenant(
    unit: Unit,
    new_person: Person,
    change_date: date,
    user,
) -> Occupancy:
    organization = unit.building.organization
    assert_member(user, organization)
    if new_person.organization_id != organization.id:
        raise ValidationError('La persona y la unidad deben pertenecer a la misma organización.')

    with audit_context(user, organization=organization):
        with transaction.atomic():
            current = (
                Occupancy.objects.select_for_update()
                .filter(unit=unit, role=Occupancy.Role.TENANT, start_date__lte=change_date)
                .filter(Q(end_date__isnull=True) | Q(end_date__gte=change_date))
                .first()
            )
            if current is not None:
                if current.person_id == new_person.id:
                    raise ValidationError('El nuevo inquilino ya es el actual.')
                current.end_date = change_date - timedelta(days=1)
                current.save(update_fields=['end_date', 'updated_at'])

            try:
                with transaction.atomic():
                    occupancy = Occupancy.objects.create(
                        unit=unit,
                        person=new_person,
                        role=Occupancy.Role.TENANT,
                        start_date=change_date,
                    )
                    record_event(
                        user,
                        organization,
                        'occupancy.replace_tenant',
                        occupancy,
                        (
                            f'Reemplazó a {current.person if current is not None else "sin inquilino"} '
                            f'por {new_person} como inquilino del apto {unit.number} '
                            f'desde {change_date:%d/%m/%Y}'
                        ),
                        unit=unit.number,
                        previous_person_id=str(current.person_id) if current is not None else None,
                        person_id=str(new_person.id),
                        start_date=change_date.isoformat(),
                    )
                    return occupancy
            except IntegrityError as error:
                if 'occupancy_no_overlap' not in str(error).lower():
                    raise
                raise ValidationError(
                    f'La unidad {unit.number} ya tiene inquilino en esas fechas.'
                ) from error


def correct_occupancy(
    occupancy: Occupancy,
    user,
    *,
    person=None,
    start_date=None,
    end_date=UNSET,
) -> Occupancy:
    organization = occupancy.unit.building.organization
    assert_member(user, organization)
    with audit_context(user, organization=organization):
        with transaction.atomic():
            occupancy = Occupancy.objects.select_for_update().get(pk=occupancy.pk)
            if occupancy.entries.exists() or ReceiptAllocation.objects.filter(
                occupancy=occupancy
            ).exists():
                raise ValidationError(
                    'La ocupación ya tiene cargos o pagos: corregí con un ajuste en la cuenta'
                )
            if person is not None and person.organization_id != organization.id:
                raise ValidationError(
                    'La persona y la unidad deben pertenecer a la misma organización.'
                )

            if person is not None:
                occupancy.person = person
            if start_date is not None:
                occupancy.start_date = start_date
            if end_date is not UNSET:
                occupancy.end_date = end_date

            try:
                with transaction.atomic():
                    update_fields = []
                    if person is not None:
                        update_fields.append('person')
                    if start_date is not None:
                        update_fields.append('start_date')
                    if end_date is not UNSET:
                        update_fields.append('end_date')
                    if update_fields:
                        occupancy.save(update_fields=update_fields + ['updated_at'])
            except IntegrityError as error:
                if 'occupancy_no_overlap' not in str(error).lower():
                    raise
                raise ValidationError('La corrección se superpone con otra ocupación.') from error
            record_event(
                user,
                organization,
                'occupancy.correct',
                occupancy,
                (
                    f'Corrigió la ocupación de {occupancy.person} del apto '
                    f'{occupancy.unit.number}: {", ".join(update_fields) or "sin cambios"}'
                ),
                unit=occupancy.unit.number,
                person_id=str(occupancy.person_id),
                start_date=occupancy.start_date.isoformat(),
                end_date=occupancy.end_date.isoformat() if occupancy.end_date else None,
            )
            return occupancy


def update_person(person: Person, user, **fields) -> Person:
    organization = person.organization
    assert_member(user, organization)
    allowed = {'first_name', 'last_name', 'document', 'phone', 'email'}
    unknown = set(fields) - allowed
    if unknown:
        raise ValidationError('Solo se pueden editar datos personales autorizados.')
    if 'email' in fields:
        fields['email'] = fields['email'].strip().lower()
        if person.user_id is not None and fields['email'] != person.email:
            raise ValidationError(
                'Esta persona ya tiene cuenta: el email de acceso se cambia reenviando la invitación'
            )

    with audit_context(user, organization=organization):
        with transaction.atomic():
            person = Person.objects.select_for_update().get(pk=person.pk)
            changed_fields = list(fields)
            for field, value in fields.items():
                setattr(person, field, value)
            person.save(update_fields=list(fields) + ['updated_at'])
            record_event(
                user,
                organization,
                'person.update',
                person,
                f'Editó los datos de {person}: {", ".join(changed_fields)}',
                changed_fields=changed_fields,
            )
            return person


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
    month = month.replace(day=1)
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
    month = month.replace(day=1)
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
    month = month.replace(day=1)
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
        occupancy = Occupancy.objects.create(
            unit=unit,
            person=buyer,
            role=Occupancy.Role.OWNER,
            start_date=sale_date,
        )
        record_event(
            user,
            organization,
            'occupancy.sell',
            occupancy,
            (
                f'Registró la venta del apto {unit.number} a {buyer} '
                f'desde el {sale_date:%d/%m/%Y}'
            ),
            unit=unit.number,
            buyer_id=str(buyer.id),
            sale_date=sale_date.isoformat(),
        )
        return occupancy
