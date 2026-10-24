from datetime import date
from decimal import Decimal

import pytest
from django.contrib import admin
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction

from apps.audit.models import RowChange
from apps.buildings.models import Unit
from apps.buildings.services import create_building
from apps.ledger.models import LedgerEntry, Receipt
from apps.ledger.payments import (
    approve_receipt,
    record_manual_payment,
    reject_receipt,
    submit_receipt,
)
from apps.people.models import Occupancy, Person
from apps.settlements.services import issue_settlement, save_draft
from tests.factories import (
    BuildingFactory,
    OrgMembershipFactory,
    OrganizationFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


def make_occupancy(organization, number, person, role=Occupancy.Role.TENANT):
    building = BuildingFactory(organization=organization)
    unit = Unit.objects.create(
        building=building,
        number=number,
        floor=1,
        coefficient='1.000000',
    )
    return Occupancy.objects.create(
        unit=unit,
        person=person,
        role=role,
        start_date=date(2026, 1, 1),
    )


def make_person(organization, suffix=''):
    return Person.objects.create(
        organization=organization,
        first_name='Ana',
        last_name=f'Prueba{suffix}',
    )


def submit(person, user, occupancy, amount='5000.00', **kwargs):
    return submit_receipt(
        person,
        user,
        file_key=f'receipts/{person.pk}-{occupancy.pk}',
        file_sha256='a' * 64,
        content_type='application/pdf',
        size_bytes=100,
        declared_amount=Decimal(amount),
        transfer_date=date(2026, 10, 21),
        allocations={occupancy: Decimal(amount)},
        **kwargs,
    )


def test_submit_is_pending_and_does_not_create_ledger_entry():
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)

    receipt = submit(person, user, occupancy)

    assert receipt.status == Receipt.Status.PENDING
    assert receipt.allocations.get().amount == Decimal('5000.00')
    assert not LedgerEntry.objects.exists()


def test_resident_can_submit_own_receipt_but_not_another_persons():
    organization = OrganizationFactory()
    resident = UserFactory()
    other_resident = UserFactory()
    person = make_person(organization)
    person.user = resident
    person.save(update_fields=['user', 'updated_at'])
    other = make_person(organization, 'other')
    occupancy = make_occupancy(organization, '1', person)
    other_occupancy = make_occupancy(organization, '2', other)
    assert submit(person, resident, occupancy).uploaded_by_id == resident.id
    with pytest.raises(PermissionDenied):
        submit(other, resident, other_occupancy, '1.00')


@pytest.mark.parametrize(
    'content_type,size_bytes',
    [('image/gif', 100), ('application/pdf', 10_485_761)],
)
def test_submit_rejects_invalid_file_metadata(content_type, size_bytes):
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)
    with pytest.raises(ValidationError):
        submit_receipt(
            person, user, file_key='invalid', file_sha256='a' * 64,
            content_type=content_type, size_bytes=size_bytes,
            declared_amount=Decimal('1.00'), transfer_date=date.today(),
            allocations={occupancy: Decimal('1.00')},
        )


def test_submit_validates_person_sum_and_multi_occupancy_note():
    organization = OrganizationFactory()
    other_organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    other_person = make_person(other_organization, 'other')
    first = make_occupancy(organization, '1', person)
    second = make_occupancy(organization, '2', person)
    foreign = make_occupancy(other_organization, '1', other_person)

    with pytest.raises(ValidationError):
        submit_receipt(
            person, user, file_key='sum', file_sha256='a' * 64,
            content_type='application/pdf', size_bytes=1,
            declared_amount=Decimal('10.00'), transfer_date=date.today(),
            allocations={first: Decimal('9.00')},
        )
    with pytest.raises(ValidationError):
        submit_receipt(
            person, user, file_key='foreign', file_sha256='a' * 64,
            content_type='application/pdf', size_bytes=1,
            declared_amount=Decimal('10.00'), transfer_date=date.today(),
            allocations={foreign: Decimal('10.00')},
        )
    with pytest.raises(ValidationError):
        submit_receipt(
            person, user, file_key='note-required', file_sha256='a' * 64,
            content_type='application/pdf', size_bytes=1,
            declared_amount=Decimal('10.00'), transfer_date=date.today(),
            allocations={first: Decimal('5.00'), second: Decimal('5.00')},
        )
    receipt = submit_receipt(
        person, user, file_key='with-note', file_sha256='a' * 64,
        content_type='application/pdf', size_bytes=1,
        declared_amount=Decimal('10.00'), transfer_date=date.today(),
        allocations={first: Decimal('5.00'), second: Decimal('5.00')},
        note='Pago de ambas unidades',
    )
    assert receipt.status == Receipt.Status.PENDING


def test_approve_creates_negative_payment_and_is_idempotent():
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)
    receipt = submit(person, user, occupancy, '5000.00')

    entries = approve_receipt(receipt, user)

    assert len(entries) == 1
    assert entries[0].amount == Decimal('-5000.00')
    assert entries[0].receipt_id == receipt.pk
    assert entries[0].created_by_id == user.pk
    assert receipt.__class__.objects.get(pk=receipt.pk).status == Receipt.Status.APPROVED
    with pytest.raises(ValidationError):
        approve_receipt(receipt, user)
    assert LedgerEntry.objects.filter(receipt=receipt).count() == 1


def test_approve_splits_one_receipt_between_two_occupancies():
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    first = make_occupancy(organization, '1', person)
    second = make_occupancy(organization, '2', person)
    receipt = submit_receipt(
        person, user, file_key='split', file_sha256='a' * 64,
        content_type='application/pdf', size_bytes=1,
        declared_amount=Decimal('5000.00'), transfer_date=date.today(),
        allocations={first: Decimal('2615.00'), second: Decimal('2385.00')},
        note='Dos unidades',
    )

    entries = approve_receipt(receipt, user)

    assert {
        entry.occupancy_id: -entry.amount for entry in entries
    } == {first.pk: Decimal('2615.00'), second.pk: Decimal('2385.00')}


def test_approve_can_replace_allocations_and_audits_deletion():
    organization = OrganizationFactory()
    employee = UserFactory()
    OrgMembershipFactory(user=employee, organization=organization)
    person = make_person(organization)
    first = make_occupancy(organization, '1', person)
    second = make_occupancy(organization, '2', person)
    receipt = submit_receipt(
        person, employee, file_key='corrected-split', file_sha256='a' * 64,
        content_type='application/pdf', size_bytes=1, declared_amount=Decimal('5000.00'),
        transfer_date=date.today(), allocations={first: Decimal('2615.00'), second: Decimal('2385.00')},
        note='Dos unidades',
    )
    entries = approve_receipt(
        receipt, employee, {first: Decimal('3000.00'), second: Decimal('2000.00')}
    )
    assert {entry.occupancy_id: -entry.amount for entry in entries} == {
        first.pk: Decimal('3000.00'), second.pk: Decimal('2000.00')
    }
    assert RowChange.objects.filter(
        table_name='ledger_receiptallocation', operation=RowChange.Operation.DELETE,
        actor=employee,
    ).exists()


def test_other_organization_cannot_review_or_record_payment():
    organization = OrganizationFactory()
    other = OrganizationFactory()
    user = UserFactory()
    foreign_user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    OrgMembershipFactory(user=foreign_user, organization=other)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)
    receipt = submit(person, user, occupancy)

    with pytest.raises(PermissionDenied):
        approve_receipt(receipt, foreign_user)
    with pytest.raises(PermissionDenied):
        reject_receipt(receipt, foreign_user, 'No figura en el extracto')
    with pytest.raises(PermissionDenied):
        record_manual_payment(occupancy, Decimal('1.00'), date.today(), foreign_user, 'Extracto')
    assert receipt.__class__.objects.get(pk=receipt.pk).status == Receipt.Status.PENDING
    assert not LedgerEntry.objects.exists()


def test_reject_requires_reason_and_preserves_receipt_without_ledger():
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)
    receipt = submit(person, user, occupancy)
    with pytest.raises(ValidationError):
        reject_receipt(receipt, user, ' ')
    rejected = reject_receipt(receipt, user, 'No coincide con el extracto')
    assert rejected.status == Receipt.Status.REJECTED
    assert Receipt.objects.filter(pk=receipt.pk).exists()
    assert not LedgerEntry.objects.exists()


def test_manual_payment_requires_source_and_has_no_receipt():
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)
    with pytest.raises(ValidationError):
        record_manual_payment(occupancy, Decimal('1.00'), date.today(), user, '')
    entry = record_manual_payment(
        occupancy, Decimal('123.45'), date.today(), user, 'Extracto Scotiabank 21/10, ref. 4821'
    )
    assert entry.kind == LedgerEntry.Kind.PAYMENT
    assert entry.amount == Decimal('-123.45')
    assert entry.receipt_id is None
    assert entry.description.startswith('Extracto')


def test_database_constraints_and_audit_log():
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    person = make_person(organization)
    occupancy = make_occupancy(organization, '1', person)
    receipt = submit(person, user, occupancy)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            LedgerEntry.objects.create(
                occupancy=occupancy, date=date.today(), kind=LedgerEntry.Kind.CHARGE,
                amount=Decimal('1.00'), receipt=receipt, created_by=user,
            )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Receipt.objects.create(
                person=person, uploaded_by=user, file_key='rejected-invalid',
                file_sha256='a' * 64, content_type='application/pdf', size_bytes=1,
                declared_amount=Decimal('1.00'), transfer_date=date.today(),
                status=Receipt.Status.REJECTED,
            )
    with pytest.raises(ValidationError):
        receipt.delete()
    approve_receipt(receipt, user)
    assert RowChange.objects.filter(
        table_name='ledger_ledgerentry', operation=RowChange.Operation.INSERT, actor=user
    ).exists()
    assert RowChange.objects.filter(
        table_name='ledger_receipt', operation=RowChange.Operation.UPDATE, actor=user,
        old_values__status='pending', new_values__status='approved',
    ).exists()
    receipt_admin = admin.site._registry[Receipt]
    assert not receipt_admin.has_delete_permission(None)


def test_settlement_guard_rolls_back_rounding_loss(monkeypatch):
    organization = OrganizationFactory()
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    building = create_building(organization, user, name='Minas', address='Prueba 1')
    unit = Unit.objects.create(
        building=building, number='1', floor=1, coefficient='1.000000'
    )
    person = make_person(organization, 'owner')
    Occupancy.objects.create(
        unit=unit, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1)
    )
    concept = building.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building, user, date(2026, 10, 1), {concept: Decimal('100.00')})

    from apps.settlements import services as settlement_services

    original_round = settlement_services._round_money
    monkeypatch.setattr(
        settlement_services,
        '_round_money',
        lambda value: original_round(value) + Decimal('0.01'),
    )
    with pytest.raises(RuntimeError):
        issue_settlement(settlement, user)
    assert not LedgerEntry.objects.filter(settlement=settlement).exists()
    assert settlement.__class__.objects.get(pk=settlement.pk).status == settlement.Status.DRAFT
