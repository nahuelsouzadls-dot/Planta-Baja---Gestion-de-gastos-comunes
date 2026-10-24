from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.money import to_money
from apps.core.money import format_money
from apps.audit.context import audit_context
from apps.audit.events import record_event

from .models import LedgerEntry


def _ensure_user(user):
    if user is None:
        raise ValueError('created_by es obligatorio.')


def balance(occupancy):
    total = LedgerEntry.objects.filter(occupancy=occupancy).aggregate(total=Sum('amount'))['total']
    return total if total is not None else Decimal('0.00')


def statement(occupancy):
    entries = LedgerEntry.objects.filter(occupancy=occupancy).order_by('date', 'created_at')
    running = Decimal('0.00')
    result = []
    for entry in entries:
        running += entry.amount
        result.append({
            'entry': entry,
            'date': entry.date,
            'kind': entry.kind,
            'amount': entry.amount,
            'description': entry.description,
            'balance': running,
        })
    return result


@transaction.atomic
def record_opening(occupancy, amount, on_date, user):
    _ensure_user(user)
    amount = to_money(amount)
    if amount == 0:
        return None
    organization = occupancy.unit.building.organization
    with audit_context(user, organization=organization):
        entry = LedgerEntry.objects.create(
            occupancy=occupancy,
            date=on_date,
            kind=LedgerEntry.Kind.OPENING,
            amount=amount,
            created_by=user,
        )
        record_event(
            user,
            organization,
            'ledger.opening',
            entry,
            f'Saldo de apertura de {format_money(amount)} en el apto {occupancy.unit.number}',
            amount=str(amount),
            unit=occupancy.unit.number,
            date=on_date.isoformat() if hasattr(on_date, 'isoformat') else str(on_date),
        )
    return entry


@transaction.atomic
def adjust(entry, amount, description, user):
    _ensure_user(user)
    amount = to_money(amount)
    if not description or not description.strip():
        raise ValidationError('La descripción del ajuste es obligatoria.')
    if amount == 0:
        raise ValidationError('El ajuste no puede ser cero.')
    organization = entry.occupancy.unit.building.organization
    with audit_context(user, organization=organization):
        adjustment = LedgerEntry.objects.create(
            occupancy=entry.occupancy,
            date=timezone.localdate(),
            kind=LedgerEntry.Kind.ADJUSTMENT,
            amount=amount,
            adjusts=entry,
            description=description,
            created_by=user,
        )
        record_event(
            user,
            organization,
            'ledger.adjust',
            adjustment,
            (
                f'Ajuste de {format_money(amount)} en el apto '
                f'{entry.occupancy.unit.number}: {description.strip()}'
            ),
            amount=str(amount),
            unit=entry.occupancy.unit.number,
            description=description.strip(),
        )
    return adjustment
