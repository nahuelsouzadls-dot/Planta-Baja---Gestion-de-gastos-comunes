from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, transaction

from apps.accounts.models import User
from apps.buildings.models import ExpenseConcept
from apps.buildings.services import create_building
from apps.settlements.models import Settlement, SettlementItem
from apps.settlements.services import delete_draft, save_draft, settlement_total
from tests.factories import OrganizationFactory


@pytest.fixture
def building(db):
    return create_building(
        OrganizationFactory(),
        name='Edificio Minas',
        address='Minas 1234',
    )


@pytest.fixture
def concepts(building):
    return {
        concept.name: concept
        for concept in building.concepts.order_by('order')
    }


def minas_items(concepts):
    return {
        concepts['O.S.E. (agua)']: Decimal('4200.00'),
        concepts['U.T.E. (luz)']: Decimal('6800.00'),
        concepts['Limpieza']: Decimal('8500.00'),
        concepts['Honorarios de administración']: Decimal('12000.00'),
        concepts['Fondo de reserva']: Decimal('4800.00'),
        concepts['Cuota extraordinaria']: Decimal('12000.00'),
    }


def test_save_draft_with_minas_amounts(building, concepts):
    settlement = save_draft(
        building,
        date(2026, 10, 21),
        minas_items(concepts),
        details={concepts['Cuota extraordinaria']: 'Impermeabilización de azotea (cuota 1 de 3)'},
    )

    assert settlement_total(settlement) == Decimal('48300.00')
    assert settlement.items.count() == 6
    assert settlement.status == Settlement.Status.DRAFT
    assert settlement.month == date(2026, 10, 1)


def test_save_draft_replaces_items(building, concepts):
    save_draft(
        building,
        date(2026, 10, 1),
        minas_items(concepts),
        details={concepts['Cuota extraordinaria']: 'Detalle'},
    )
    settlement = save_draft(
        building,
        date(2026, 10, 1),
        {concepts['Limpieza']: Decimal('100.00')},
    )

    assert settlement.items.count() == 1
    assert settlement_total(settlement) == Decimal('100.00')


def test_save_draft_validates_amounts_and_details(building, concepts):
    with pytest.raises(ValidationError):
        save_draft(building, date(2026, 10, 1), {concepts['Cuota extraordinaria']: Decimal('1')})
    save_draft(building, date(2026, 10, 1), {concepts['Fondo de reserva']: Decimal('1')})

    with pytest.raises(TypeError):
        save_draft(building, date(2026, 11, 1), {concepts['Limpieza']: 1.0})
    with pytest.raises(ValidationError):
        save_draft(building, date(2026, 12, 1), {concepts['Limpieza']: Decimal('-1')})
    with pytest.raises(ValidationError):
        save_draft(building, date(2027, 1, 1), {concepts['Limpieza']: Decimal('0')})


def test_save_draft_rejects_concept_from_other_building(building):
    other = create_building(OrganizationFactory(), name='Otro', address='Otra 1')
    concept = other.concepts.first()

    with pytest.raises(ValidationError):
        save_draft(building, date(2026, 10, 1), {concept: Decimal('1')})


def test_delete_draft_deletes_settlement_and_items(building, concepts):
    settlement = save_draft(
        building,
        date(2026, 10, 1),
        {
            concepts['O.S.E. (agua)']: Decimal('100.00'),
            concepts['U.T.E. (luz)']: Decimal('200.00'),
            concepts['Limpieza']: Decimal('300.00'),
        },
    )
    settlement_id = settlement.pk

    delete_draft(settlement)

    assert not Settlement.objects.filter(pk=settlement_id).exists()
    assert not SettlementItem.objects.filter(settlement_id=settlement_id).exists()


def test_delete_draft_rejects_issued_settlement(building, concepts, db):
    admin = User.objects.create_user(email='admin@example.com', password='test-password-123')
    settlement = save_draft(
        building,
        date(2026, 10, 1),
        {concepts['Limpieza']: Decimal('100.00')},
    )
    Settlement.objects.filter(pk=settlement.pk).update(
        status=Settlement.Status.ISSUED,
        issued_at='2026-10-01T12:00:00Z',
        issued_by=admin,
    )

    with pytest.raises(ValidationError):
        delete_draft(settlement)

    assert Settlement.objects.filter(pk=settlement.pk).exists()


def test_draft_settlement_can_be_deleted_directly_with_orm(building, concepts):
    settlement = save_draft(
        building,
        date(2026, 10, 1),
        {concepts['Limpieza']: Decimal('100.00')},
    )
    settlement_id = settlement.pk

    Settlement.objects.filter(pk=settlement_id).delete()

    assert not Settlement.objects.filter(pk=settlement_id).exists()
    assert not SettlementItem.objects.filter(settlement_id=settlement_id).exists()


def test_draft_settlement_can_be_updated_to_issued(building, concepts, db):
    admin = User.objects.create_user(email='admin@example.com', password='test-password-123')
    settlement = save_draft(
        building,
        date(2026, 10, 1),
        {concepts['Limpieza']: Decimal('100.00')},
    )

    Settlement.objects.filter(pk=settlement.pk).update(
        status=Settlement.Status.ISSUED,
        issued_at='2026-10-01T12:00:00Z',
        issued_by=admin,
    )

    settlement.refresh_from_db()
    assert settlement.status == Settlement.Status.ISSUED


def test_issued_settlement_and_items_are_immutable(building, concepts, db):
    admin = User.objects.create_user(email='admin@example.com', password='test-password-123')
    settlement = save_draft(
        building,
        date(2026, 10, 1),
        {concepts['Limpieza']: Decimal('100.00')},
    )
    Settlement.objects.filter(pk=settlement.pk).update(
        status=Settlement.Status.ISSUED,
        issued_at='2026-10-01T12:00:00Z',
        issued_by=admin,
    )
    item = settlement.items.get()

    with pytest.raises((DatabaseError, IntegrityError)):
        with transaction.atomic():
            Settlement.objects.filter(pk=settlement.pk).update(status=Settlement.Status.DRAFT)
    with pytest.raises((DatabaseError, IntegrityError)):
        with transaction.atomic():
            SettlementItem.objects.filter(pk=item.pk).update(amount=Decimal('1.00'))
    with pytest.raises((DatabaseError, IntegrityError)):
        with transaction.atomic():
            SettlementItem.objects.create(
                settlement=settlement,
                concept=concepts['O.S.E. (agua)'],
                amount=Decimal('1.00'),
            )
    with pytest.raises((DatabaseError, IntegrityError)):
        with transaction.atomic():
            SettlementItem.objects.filter(pk=item.pk).delete()
    with pytest.raises((DatabaseError, IntegrityError)):
        with transaction.atomic():
            settlement.delete()
    with pytest.raises(ValidationError):
        save_draft(building, date(2026, 10, 1), {concepts['Limpieza']: Decimal('10.00')})


def test_settlement_constraints(building, concepts, db):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Settlement.objects.create(building=building, month=date(2026, 10, 2))

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Settlement.objects.create(
                building=building,
                month=date(2026, 11, 1),
                status=Settlement.Status.ISSUED,
            )
