"""Datos de una liquidación emitida, leídos del libro mayor, para el Excel y el PDF."""
from collections import defaultdict
from decimal import Decimal

from apps.ledger.models import LedgerEntry


def settlement_items(settlement):
    return list(settlement.items.select_related('concept').order_by('concept__order', 'concept__name'))


def settlement_charges(settlement):
    """Una fila por cuenta (unidad + rol) con lo que le tocó de cada concepto y su total."""
    entries = (
        LedgerEntry.objects.filter(settlement=settlement, kind=LedgerEntry.Kind.CHARGE)
        .select_related('occupancy__unit', 'occupancy__person', 'concept')
    )
    accounts = {}
    for entry in entries:
        occupancy = entry.occupancy
        account = accounts.setdefault(occupancy.pk, {
            'occupancy_id': occupancy.pk,
            'unit': occupancy.unit.number,
            'floor': occupancy.unit.floor,
            'role': occupancy.role,
            'person': str(occupancy.person),
            'coefficient': occupancy.unit.coefficient,
            'receives_paper': occupancy.unit.receives_paper,
            'by_concept': defaultdict(lambda: Decimal('0')),
            'total': Decimal('0'),
        })
        account['by_concept'][entry.concept.name] += entry.amount
        account['total'] += entry.amount

    def order(account):
        number = account['unit']
        return (int(number) if number.isdigit() else 10**9, number, account['role'] != 'owner')

    return sorted(accounts.values(), key=order)
