from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db.models import Q

from apps.communications.models import Claim
from apps.ledger.models import LedgerEntry, Receipt
from apps.people.models import Occupancy


@dataclass(frozen=True)
class PortfolioTotals:
    accounts: int
    expected: Decimal
    collected: Decimal
    in_review: Decimal
    debt: Decimal
    delinquent: int
    open_claims: int


def _periods(entries):
    charged = {}
    credits = Decimal('0.00')
    for entry in entries:
        if entry.kind == LedgerEntry.Kind.CHARGE and entry.amount > 0:
            month = entry.settlement.month
            charged[month] = charged.get(month, Decimal('0.00')) + entry.amount
        elif entry.kind in {
            LedgerEntry.Kind.OPENING,
            LedgerEntry.Kind.SURCHARGE,
            LedgerEntry.Kind.ADJUSTMENT,
        } and entry.amount > 0:
            month = entry.date.replace(day=1)
            charged[month] = charged.get(month, Decimal('0.00')) + entry.amount
        elif entry.amount < 0:
            credits -= entry.amount

    result = []
    for month in sorted(charged):
        covered = min(charged[month], credits)
        credits -= covered
        result.append((month, charged[month], covered, charged[month] - covered))
    return result


def portfolio_totals(organization, current_month: date) -> PortfolioTotals:
    current = current_month.replace(day=1)
    occupancies = list(
        Occupancy.objects.filter(unit__building__organization=organization)
        .filter(Q(start_date__lte=current) | Q(start_date__isnull=True))
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=current))
        .select_related('unit__building')
    )
    occupancy_ids = [occupancy.id for occupancy in occupancies]
    entries = (
        LedgerEntry.objects.filter(occupancy_id__in=occupancy_ids)
        .select_related('settlement')
        .order_by('occupancy_id', 'date', 'created_at', 'pk')
    )
    entries_by_occupancy = {occupancy_id: [] for occupancy_id in occupancy_ids}
    for entry in entries:
        entries_by_occupancy[entry.occupancy_id].append(entry)

    review_occupancy_ids = set()
    for receipt in Receipt.objects.filter(
        status=Receipt.Status.PENDING,
        allocations__occupancy_id__in=occupancy_ids,
    ).prefetch_related('allocations'):
        for allocation in receipt.allocations.all():
            review_occupancy_ids.add(allocation.occupancy_id)

    expected = collected = in_review = debt = Decimal('0.00')
    delinquent = 0
    for occupancy in occupancies:
        periods = _periods(entries_by_occupancy[occupancy.id])
        current_period = next((period for period in periods if period[0] == current), None)
        if current_period:
            expected += current_period[1]
            collected += current_period[2]
        overdue = sum(
            (period[3] for period in periods if period[0] < current),
            Decimal('0.00'),
        )
        debt += overdue
        if occupancy.id in review_occupancy_ids:
            in_review += sum(
                (period[3] for period in periods),
                Decimal('0.00'),
            )
        elif overdue > 0:
            delinquent += 1

    open_claims = Claim.objects.filter(
        building__organization=organization,
    ).exclude(status=Claim.Status.RESOLVED).count()
    return PortfolioTotals(
        accounts=len(occupancies),
        expected=expected,
        collected=collected,
        in_review=in_review,
        debt=debt,
        delinquent=delinquent,
        open_claims=open_claims,
    )
