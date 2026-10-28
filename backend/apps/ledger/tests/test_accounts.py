from datetime import date
from decimal import Decimal

import pytest

from apps.ledger.accounts import account_status, credit_balance, overdue_months, periods
from apps.ledger.models import LedgerEntry, Receipt
from apps.ledger.payments import record_manual_payment, submit_receipt
from apps.settlements.services import issue_settlement, save_draft
from apps.settlements.tests.test_issue import (
    _golden_building,
    _golden_details,
    _golden_items,
)
from apps.settlements.models import Settlement
from apps.people.models import Occupancy
from tests.golden import load_demo
from tests.factories import (
    BuildingFactory,
    OccupancyFactory,
    OrgMembershipFactory,
    PersonFactory,
    UserFactory,
)


pytestmark = pytest.mark.django_db


def test_periods_are_fifo_and_leave_credit():
    occupancy = OccupancyFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=occupancy.unit.building.organization)
    for month in (7, 8, 9):
        LedgerEntry.objects.create(
            occupancy=occupancy, date=date(2026, month, 1),
            kind=LedgerEntry.Kind.SURCHARGE, amount=Decimal('1000.00'),
            created_by=user,
        )
    record_manual_payment(occupancy, Decimal('1500.00'), date(2026, 10, 1), user, 'Banco')
    assert [(p.month, p.outstanding) for p in periods(occupancy)] == [
        (date(2026, 7, 1), Decimal('0.00')),
        (date(2026, 8, 1), Decimal('500.00')),
        (date(2026, 9, 1), Decimal('1000.00')),
    ]
    record_manual_payment(occupancy, Decimal('2000.00'), date(2026, 10, 2), user, 'Banco')
    assert credit_balance(occupancy) == Decimal('500.00')


def test_account_status_order():
    occupancy = OccupancyFactory()
    user = UserFactory()
    organization = occupancy.unit.building.organization
    OrgMembershipFactory(user=user, organization=organization)
    month = date(2026, 10, 1)
    assert account_status(occupancy, month) == 'sin-cargar'
    Settlement.objects.create(
        building=occupancy.unit.building, month=month, status=Settlement.Status.ISSUED,
        issued_by=user, issued_at='2026-10-01T00:00:00Z',
    )
    assert account_status(occupancy, month) == 'pagado'


def test_account_status_revision():
    occupancy = OccupancyFactory()
    resident = UserFactory()
    occupancy.person.user = resident
    occupancy.person.save(update_fields=['user', 'updated_at'])
    submit_receipt(
        occupancy.person,
        resident,
        file_key='status-revision',
        file_sha256='c' * 64,
        content_type='application/pdf',
        size_bytes=1,
        declared_amount=Decimal('10.00'),
        transfer_date=date(2026, 10, 10),
        allocations={occupancy: Decimal('10.00')},
    )
    assert account_status(occupancy, date(2026, 10, 1)) == 'revision'


def test_account_status_moroso():
    occupancy = OccupancyFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=occupancy.unit.building.organization)
    LedgerEntry.objects.create(
        occupancy=occupancy,
        date=date(2026, 9, 1),
        kind=LedgerEntry.Kind.SURCHARGE,
        amount=Decimal('10.00'),
        created_by=user,
    )
    assert account_status(occupancy, date(2026, 10, 1)) == 'moroso'


def test_account_status_pendiente():
    occupancy = OccupancyFactory()
    user = UserFactory()
    organization = occupancy.unit.building.organization
    OrgMembershipFactory(user=user, organization=organization)
    Settlement.objects.create(
        building=occupancy.unit.building,
        month=date(2026, 10, 1),
        status=Settlement.Status.ISSUED,
        issued_by=user,
        issued_at='2026-10-01T00:00:00Z',
    )
    LedgerEntry.objects.create(
        occupancy=occupancy,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.SURCHARGE,
        amount=Decimal('10.00'),
        created_by=user,
    )
    assert account_status(occupancy, date(2026, 10, 1)) == 'pendiente'


def test_overdue_months_only_returns_older_uncovered_periods():
    occupancy = OccupancyFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=occupancy.unit.building.organization)
    for month in (8, 9):
        LedgerEntry.objects.create(
            occupancy=occupancy, date=date(2026, month, 1),
            kind=LedgerEntry.Kind.SURCHARGE, amount=Decimal('10.00'),
            created_by=user,
        )
    assert overdue_months(occupancy, date(2026, 10, 1)) == [
        date(2026, 8, 1), date(2026, 9, 1)
    ]


def test_golden_minas_accounts_match_front():
    try:
        data = load_demo()
    except FileNotFoundError as error:
        pytest.skip(str(error))
    golden = next(building for building in data['buildings'] if building['id'] == 'minas')
    employee = UserFactory()
    building = _golden_building(golden, employee)
    for person in building.organization.people.all():
        resident = UserFactory()
        person.user = resident
        person.save(update_fields=['user', 'updated_at'])
    for expense in golden['expenses']:
        settlement = save_draft(
            building,
            employee,
            date.fromisoformat(f"{expense['month']}-01"),
            _golden_items(building, expense),
            details=_golden_details(building, expense),
        )
        issue_settlement(settlement, employee)

    for key, expected in golden['accounts'].items():
        unit_number, role = key.split(':')
        occupancy = Occupancy.objects.get(unit__building=building, unit__number=unit_number, role=role)
        for movement in expected['movements']:
            credit = Decimal(movement['credit'])
            if credit:
                record_manual_payment(
                    occupancy, credit, date.fromisoformat(movement['date']),
                    employee, 'Golden transferencia',
                )
        if expected['review']:
            amount = Decimal(expected['balance'])
            submit_receipt(
                occupancy.person,
                occupancy.person.user,
                file_key=f'golden/{key.replace(":", "-")}',
                file_sha256='b' * 64,
                content_type='application/pdf',
                size_bytes=1,
                declared_amount=amount,
                transfer_date=date.fromisoformat(expected['review']['uploadedAt']),
                allocations={occupancy: amount},
            )
        actual_periods = periods(occupancy)
        actual_balance = sum((period.outstanding for period in actual_periods), Decimal('0.00'))
        assert account_status(occupancy, date(2026, 10, 1)) == expected['status'], key
        assert actual_balance == Decimal(expected['balance']), key
        assert overdue_months(occupancy, date(2026, 10, 1)) == [
            date.fromisoformat(f"{month['month']}-01") for month in expected['overdueMonths']
        ], key
