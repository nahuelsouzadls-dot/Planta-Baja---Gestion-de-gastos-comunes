from decimal import Decimal

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.urls import reverse

from apps.ledger.models import LedgerEntry
from apps.ledger.services import adjust, balance, record_opening, statement
from tests.factories import (
    ExpenseConceptFactory,
    LedgerEntryFactory,
    OccupancyFactory,
    SettlementFactory,
    UserFactory,
)


pytestmark = pytest.mark.django_db


def charge_kwargs(occupancy, user, settlement=None, concept=None, amount='361.20'):
    settlement = settlement or SettlementFactory(building=occupancy.unit.building)
    concept = concept or ExpenseConceptFactory(building=occupancy.unit.building)
    return {
        'occupancy': occupancy,
        'date': '2026-10-01',
        'kind': LedgerEntry.Kind.CHARGE,
        'amount': amount,
        'settlement': settlement,
        'concept': concept,
        'base_amount': amount,
        'coefficient': '1.000000',
        'days': 31,
        'days_in_month': 31,
        'created_by': user,
    }


def test_orm_update_is_rejected_by_database():
    entry = LedgerEntryFactory(amount='100.00')
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            LedgerEntry.objects.filter(pk=entry.pk).update(amount='200.00')
    entry.refresh_from_db()
    assert entry.amount == Decimal('100.00')


def test_orm_delete_is_rejected_by_database():
    entry = LedgerEntryFactory(amount='100.00')
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            LedgerEntry.objects.filter(pk=entry.pk).delete()
    assert LedgerEntry.objects.filter(pk=entry.pk).exists()


@pytest.mark.parametrize('sql', [
    'UPDATE ledger_ledgerentry SET amount = 1',
    'DELETE FROM ledger_ledgerentry',
    'TRUNCATE ledger_ledgerentry',
])
def test_raw_mutations_are_rejected_by_database(sql):
    entry = LedgerEntryFactory(amount='100.00')
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(sql)
    entry.refresh_from_db()
    assert entry.amount == Decimal('100.00')


def test_model_is_append_only():
    entry = LedgerEntryFactory()
    entry.amount = Decimal('200.00')
    with pytest.raises(ValidationError):
        entry.save()
    with pytest.raises(ValidationError):
        entry.delete()


@pytest.mark.parametrize('changes', [
    {'kind': LedgerEntry.Kind.PAYMENT, 'amount': '1.00'},
    {'kind': LedgerEntry.Kind.CHARGE, 'amount': '-1.00'},
    {'kind': LedgerEntry.Kind.CHARGE, 'settlement': None},
    {'kind': LedgerEntry.Kind.ADJUSTMENT, 'adjusts': None},
    {'amount': '0.00'},
    {'days': 0},
    {'days': 32, 'days_in_month': 31},
])
def test_constraints_reject_invalid_entries(changes):
    occupancy = OccupancyFactory()
    user = UserFactory()
    kwargs = charge_kwargs(occupancy, user)
    kwargs.update(changes)
    if changes.get('kind') == LedgerEntry.Kind.PAYMENT:
        kwargs = {
            'occupancy': occupancy,
            'date': '2026-10-01',
            'kind': LedgerEntry.Kind.PAYMENT,
            'amount': changes['amount'],
            'created_by': user,
        }
    if changes.get('kind') == LedgerEntry.Kind.ADJUSTMENT:
        kwargs = {
            'occupancy': occupancy,
            'date': '2026-10-01',
            'kind': LedgerEntry.Kind.ADJUSTMENT,
            'amount': '1.00',
            'created_by': user,
        }
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            LedgerEntry.objects.create(**kwargs)


@pytest.mark.parametrize('changes', [
    {'kind': 'invalido'},
    {'days': 999, 'days_in_month': None},
    {'base_amount': '-1.00'},
    {'coefficient': '2.000000'},
    {'adjusts': LedgerEntry},
])
def test_database_rejects_invalid_cross_field_combinations(changes):
    occupancy = OccupancyFactory()
    user = UserFactory()
    kwargs = charge_kwargs(occupancy, user)
    if changes.get('kind') == 'invalido':
        kwargs = {
            'occupancy': occupancy,
            'date': '2026-10-01',
            'kind': 'invalido',
            'amount': '1.00',
            'created_by': user,
        }
    elif changes.get('adjusts') is LedgerEntry:
        original = LedgerEntryFactory(occupancy=occupancy)
        kwargs = {
            'occupancy': occupancy,
            'date': '2026-10-01',
            'kind': LedgerEntry.Kind.CHARGE,
            'amount': '1.00',
            'created_by': user,
            'adjusts': original,
        }
    else:
        kwargs.update(changes)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            LedgerEntry.objects.create(**kwargs)


def test_unique_charge_and_opening_constraints():
    occupancy = OccupancyFactory()
    user = UserFactory()
    kwargs = charge_kwargs(occupancy, user)
    LedgerEntry.objects.create(**kwargs)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            LedgerEntry.objects.create(**kwargs)

    opening = LedgerEntryFactory(occupancy=OccupancyFactory(), amount='100.00')
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            LedgerEntry.objects.create(
                occupancy=opening.occupancy,
                date='2026-10-02',
                kind=LedgerEntry.Kind.OPENING,
                amount='50.00',
                created_by=user,
            )


def test_balance_and_statement_are_accumulated():
    occupancy = OccupancyFactory()
    user = UserFactory()
    record_opening(occupancy, Decimal('1000.00'), '2026-10-01', user)
    LedgerEntry.objects.create(**charge_kwargs(occupancy, user))
    LedgerEntry.objects.create(
        occupancy=occupancy,
        date='2026-10-03',
        kind=LedgerEntry.Kind.PAYMENT,
        amount='-500.00',
        created_by=user,
    )
    original = LedgerEntry.objects.order_by('created_at').first()
    adjust(original, Decimal('-61.20'), 'Corrección de apertura', user)
    assert balance(occupancy) == Decimal('800.00')
    assert [line['balance'] for line in statement(occupancy)] == [
        Decimal('1000.00'),
        Decimal('1361.20'),
        Decimal('861.20'),
        Decimal('800.00'),
    ]


def test_adjust_requires_description_and_references_original():
    entry = LedgerEntryFactory()
    user = UserFactory()
    with pytest.raises(ValidationError):
        adjust(entry, Decimal('1.00'), ' ', user)
    correction = adjust(entry, Decimal('-1.00'), 'Ajuste válido', user)
    assert correction.occupancy_id == entry.occupancy_id
    assert correction.adjusts_id == entry.pk


def test_record_opening_zero_and_float():
    occupancy = OccupancyFactory()
    user = UserFactory()
    assert record_opening(occupancy, Decimal('0.00'), '2026-10-01', user) is None
    assert not LedgerEntry.objects.filter(occupancy=occupancy).exists()
    with pytest.raises(TypeError):
        record_opening(occupancy, 1.0, '2026-10-01', user)
    with pytest.raises(ValidationError, match='máximo 2 decimales'):
        record_opening(occupancy, Decimal('0.004'), '2026-10-01', user)


def test_admin_is_read_only(client):
    user = UserFactory(is_staff=True, is_superuser=True)
    client.force_login(user)
    response = client.get(reverse('admin:ledger_ledgerentry_add'))
    assert response.status_code == 403
    entry = LedgerEntryFactory(created_by=user)
    assert client.post(
        reverse('admin:ledger_ledgerentry_change', args=[entry.pk]),
        {'amount': '200.00'},
    ).status_code == 403
    assert client.post(
        reverse('admin:ledger_ledgerentry_delete', args=[entry.pk]),
    ).status_code == 403
    entry.refresh_from_db()
    assert entry.amount == Decimal('100.00')
    model_admin = admin.site._registry[LedgerEntry]
    assert not model_admin.has_add_permission(None)
    assert not model_admin.has_change_permission(None)
    assert not model_admin.has_delete_permission(None)
