import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone

from apps.people.models import Occupancy
from apps.settlements.models import Settlement

from .models import LedgerEntry, Receipt, ReceiptAllocation


@dataclass(frozen=True)
class Period:
    month: date
    charged: Decimal
    covered: Decimal
    outstanding: Decimal


@dataclass(frozen=True)
class PortalAccountSummary:
    balance: Decimal
    current_charge: Decimal
    status: str
    overdue_months: list[date]
    unpaid_months: list[date]
    role_note: str
    closed: bool
    pending_allocation: ReceiptAllocation | None


def _month(value: date) -> date:
    return value.replace(day=1)


def _month_end(value: date) -> date:
    return date(value.year, value.month, calendar.monthrange(value.year, value.month)[1])


def _overlaps_month(occupancy: Occupancy, month: date) -> bool:
    start = _month(month)
    end = _month_end(start)
    return occupancy.start_date <= end and (
        occupancy.end_date is None or occupancy.end_date >= start
    )


def _entries(occupancy):
    return (
        LedgerEntry.objects.filter(occupancy=occupancy)
        .select_related('settlement', 'concept', 'adjusts__settlement')
        .order_by('date', 'created_at', 'pk')
    )


def periods_from_entries(entries) -> list[Period]:
    charged_by_month = {}
    credit_pool = Decimal('0.00')
    for entry in entries:
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
            target = entry.adjusts
            if target is not None and target.kind in {
                LedgerEntry.Kind.CHARGE,
                LedgerEntry.Kind.OPENING,
                LedgerEntry.Kind.SURCHARGE,
            } and target.amount > 0:
                if target.kind == LedgerEntry.Kind.CHARGE:
                    month = _month(target.settlement.month)
                else:
                    month = _month(target.date)
                charged_by_month[month] = (
                    charged_by_month.get(month, Decimal('0.00')) + entry.amount
                )
            elif target is not None:
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


def periods(occupancy) -> list[Period]:
    return periods_from_entries(_entries(occupancy))


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
    if sum((period.outstanding for period in periods(occupancy)), Decimal('0.00')) > 0:
        return 'pendiente'
    if not occupancy.unit.building.settlements.filter(
        month=_month(current_month),
        status='issued',
    ).exists():
        return 'sin-cargar'
    return 'pagado'


def overdue_months(occupancy, current_month: date) -> list[date]:
    current = _month(current_month)
    return [period.month for period in periods(occupancy) if period.month < current and period.outstanding > 0]


def portal_account_summary(occupancy: Occupancy, current_month: date) -> PortalAccountSummary:
    current = _month(current_month)
    entries = list(_entries(occupancy))
    account_periods = periods_from_entries(entries)
    balance = sum((entry.amount for entry in entries), Decimal('0.00'))
    current_charge = sum(
        (
            entry.amount
            for entry in entries
            if entry.kind == LedgerEntry.Kind.CHARGE
            and entry.settlement_id
            and entry.settlement.month == current
        ),
        Decimal('0.00'),
    )
    overdue = [p.month for p in account_periods if p.month < current and p.outstanding > 0]
    unpaid = [p.month for p in account_periods if p.outstanding > 0]

    pending_allocation = (
        ReceiptAllocation.objects.filter(
            occupancy=occupancy,
            receipt__status=Receipt.Status.PENDING,
        )
        .select_related('receipt')
        .order_by('-receipt__transfer_date', '-receipt__created_at', '-pk')
        .first()
    )
    settlement_issued = Settlement.objects.filter(
        building_id=occupancy.unit.building_id,
        month=current,
        status=Settlement.Status.ISSUED,
    ).exists()

    if pending_allocation is not None:
        status = 'revision'
    elif overdue:
        status = 'moroso'
    elif balance > Decimal('0.00') or unpaid:
        status = 'pendiente'
    elif not settlement_issued and current_charge == Decimal('0.00'):
        status = 'sin-cargar'
    else:
        status = 'pagado'

    today = timezone.localdate()
    if occupancy.role == Occupancy.Role.TENANT:
        role_note = 'pagás los gastos comunes'
    else:
        has_tenant = (
            Occupancy.objects.filter(
                unit_id=occupancy.unit_id,
                role=Occupancy.Role.TENANT,
                start_date__lte=today,
            )
            .filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
            .exists()
        )
        role_note = 'pagás fondo de reserva y extraordinarios' if has_tenant else ''

    return PortalAccountSummary(
        balance=balance,
        current_charge=current_charge,
        status=status,
        overdue_months=overdue,
        unpaid_months=unpaid,
        role_note=role_note,
        closed=occupancy.end_date is not None,
        pending_allocation=pending_allocation,
    )


def portal_months(occupancy: Occupancy, current_month: date) -> list[dict]:
    current = _month(current_month)
    entries = list(_entries(occupancy))
    period_by_month = {p.month: p for p in periods_from_entries(entries)}
    charged_settlement_ids = {
        entry.settlement_id
        for entry in entries
        if entry.kind == LedgerEntry.Kind.CHARGE and entry.settlement_id
    }
    settlements = list(
        Settlement.objects.filter(
            building_id=occupancy.unit.building_id,
            status=Settlement.Status.ISSUED,
        ).order_by('-month')
    )
    result = []
    for settlement in settlements:
        if not (
            _overlaps_month(occupancy, settlement.month)
            or settlement.pk in charged_settlement_ids
        ):
            continue
        period = period_by_month.get(settlement.month)
        outstanding = period.outstanding if period else Decimal('0.00')
        charged = period.charged if period else Decimal('0.00')
        if outstanding <= Decimal('0.00'):
            status = 'ok'
        elif settlement.month < current:
            status = 'bad'
        else:
            status = 'warn'
        result.append(
            {
                'month': settlement.month,
                'status': status,
                'charged': charged,
                'outstanding': outstanding,
            }
        )
    return result


def portal_settlement_detail(occupancy: Occupancy, month: date) -> dict | None:
    normalized = _month(month)
    settlement = (
        Settlement.objects.filter(
            building_id=occupancy.unit.building_id,
            month=normalized,
            status=Settlement.Status.ISSUED,
        )
        .prefetch_related('items__concept')
        .first()
    )
    if settlement is None:
        return None
    charge_entries = list(
        LedgerEntry.objects.filter(
            occupancy=occupancy,
            settlement=settlement,
            kind=LedgerEntry.Kind.CHARGE,
        )
        .select_related('concept')
        .order_by('concept__order', 'pk')
    )
    if not charge_entries and not _overlaps_month(occupancy, normalized):
        return None
    item_by_concept = {item.concept_id: item for item in settlement.items.all()}
    lines = []
    for entry in charge_entries:
        item = item_by_concept.get(entry.concept_id)
        building_total = item.amount if item is not None else entry.base_amount
        detail = item.detail if item is not None else ''
        lines.append(
            {
                'concept': entry.concept.name,
                'building_total': building_total,
                'amount': entry.amount,
                'detail': detail,
                'coefficient': entry.coefficient,
                'days': entry.days,
                'days_in_month': entry.days_in_month,
            }
        )
    coef = (
        charge_entries[0].coefficient
        if charge_entries
        else occupancy.unit.coefficient
    )
    total = sum((entry.amount for entry in charge_entries), Decimal('0.00'))
    return {
        'month': settlement.month,
        'coefficient': coef,
        'lines': lines,
        'total': total,
    }


def portal_movements(occupancy: Occupancy) -> list[dict]:
    entries = list(_entries(occupancy))
    running = Decimal('0.00')
    movements = []
    for entry in entries:
        running += entry.amount
        movements.append(
            {
                'id': str(entry.pk),
                'date': entry.date,
                'kind': entry.kind,
                'concept': entry.description
                or (
                    entry.concept.name
                    if entry.concept
                    else entry.get_kind_display()
                ),
                'debit': entry.amount if entry.amount > Decimal('0.00') else Decimal('0.00'),
                'credit': -entry.amount if entry.amount < Decimal('0.00') else Decimal('0.00'),
                'balance': running,
            }
        )
    movements.reverse()
    return movements
