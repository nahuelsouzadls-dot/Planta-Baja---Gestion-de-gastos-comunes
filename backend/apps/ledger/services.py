from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from .models import LedgerEntry


def _ensure_decimal(value):
    if isinstance(value, float):
        raise TypeError('Los montos deben ser Decimal, no float.')
    return value if isinstance(value, Decimal) else Decimal(value)


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
    amount = _ensure_decimal(amount)
    if amount == 0:
        return None
    return LedgerEntry.objects.create(
        occupancy=occupancy,
        date=on_date,
        kind=LedgerEntry.Kind.OPENING,
        amount=amount,
        created_by=user,
    )


@transaction.atomic
def adjust(entry, amount, description, user):
    _ensure_user(user)
    amount = _ensure_decimal(amount)
    if not description or not description.strip():
        raise ValidationError('La descripción del ajuste es obligatoria.')
    if amount == 0:
        raise ValidationError('El ajuste no puede ser cero.')
    return LedgerEntry.objects.create(
        occupancy=entry.occupancy,
        date=timezone.localdate(),
        kind=LedgerEntry.Kind.ADJUSTMENT,
        amount=amount,
        adjusts=entry,
        description=description,
        created_by=user,
    )
