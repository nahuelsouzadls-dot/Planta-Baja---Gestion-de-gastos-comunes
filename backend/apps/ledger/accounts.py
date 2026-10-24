from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .models import LedgerEntry, Receipt


@dataclass(frozen=True)
class Period:
    month: date
    charged: Decimal
    covered: Decimal
    outstanding: Decimal


def _month(value: date) -> date:
    return value.replace(day=1)


def _entries(occupancy):
    return LedgerEntry.objects.filter(occupancy=occupancy).order_by('date', 'created_at', 'pk')


def periods(occupancy) -> list[Period]:
    charged_by_month = {}
    credit_pool = Decimal('0.00')
    for entry in _entries(occupancy):
        if entry.kind == LedgerEntry.Kind.CHARGE and entry.amount > 0:
            month = _month(entry.settlement.month)
            charged_by_month[month] = charged_by_month.get(month, Decimal('0.00')) + entry.amount
        elif entry.kind == LedgerEntry.Kind.OPENING or entry.kind == LedgerEntry.Kind.SURCHARGE:
            if entry.amount > 0:
                month = _month(entry.date)
                charged_by_month[month] = charged_by_month.get(month, Decimal('0.00')) + entry.amount
            else:
                credit_pool -= entry.amount
        elif entry.kind == LedgerEntry.Kind.ADJUSTMENT:
            if entry.amount > 0:
                month = _month(entry.date)
                charged_by_month[month] = charged_by_month.get(month, Decimal('0.00')) + entry.amount
            else:
                credit_pool -= entry.amount
        elif entry.amount < 0:
            credit_pool -= entry.amount

    result = []
    for month in sorted(charged_by_month):
        charged = charged_by_month[month]
        covered = min(charged, credit_pool)
        credit_pool -= covered
        result.append(Period(month, charged, covered, charged - covered))
    return result


def credit_balance(occupancy) -> Decimal:
    total_charged = sum((period.charged for period in periods(occupancy)), Decimal('0.00'))
    total_credits = sum(
        (-entry.amount for entry in _entries(occupancy) if entry.amount < 0),
        Decimal('0.00'),
    )
    return max(Decimal('0.00'), total_credits - total_charged)


def account_status(occupancy, current_month: date) -> str:
    if Receipt.objects.filter(
        status=Receipt.Status.PENDING,
        allocations__occupancy=occupancy,
    ).exists():
        return 'revision'
    if any(period.month < _month(current_month) and period.outstanding > 0 for period in periods(occupancy)):
        return 'moroso'
    if not occupancy.unit.building.settlements.filter(
        month=_month(current_month),
        status='issued',
    ).exists():
        return 'sin-cargar'
    if sum((period.outstanding for period in periods(occupancy)), Decimal('0.00')) > 0:
        return 'pendiente'
    return 'pagado'


def overdue_months(occupancy, current_month: date) -> list[date]:
    current = _month(current_month)
    return [period.month for period in periods(occupancy) if period.month < current and period.outstanding > 0]
