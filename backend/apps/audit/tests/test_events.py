import json
from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.audit.models import AuditLog
from apps.communications.models import Claim
from apps.communications.services import publish_notice, set_claim_status
from apps.ledger.models import LedgerEntry, Receipt, ReceiptAllocation
from apps.ledger.payments import (
    approve_receipt,
    record_manual_payment,
    reject_receipt,
)
from apps.ledger.services import adjust, record_opening
from apps.people.models import Occupancy
from apps.people.services import (
    correct_occupancy,
    move_in,
    move_out,
    replace_tenant,
    sell_unit,
    update_person,
)
from apps.settlements.services import issue_settlement, save_draft
from tests.factories import (
    BuildingFactory,
    ClaimFactory,
    ExpenseConceptFactory,
    OccupancyFactory,
    OrgMembershipFactory,
    PersonFactory,
    SettlementFactory,
    UnitFactory,
    UserFactory,
)


pytestmark = pytest.mark.django_db


def employee_for(building):
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=building.organization)
    return user


def owner_for(unit, *, name='Ana', last_name='Pérez', start_date=date(2026, 1, 1)):
    person = PersonFactory(
        organization=unit.building.organization,
        first_name=name,
        last_name=last_name,
    )
    return Occupancy.objects.create(
        unit=unit,
        person=person,
        role=Occupancy.Role.OWNER,
        start_date=start_date,
    )


def tenant_for(unit, *, name='Lucía', last_name='Gómez', start_date=date(2026, 1, 1)):
    person = PersonFactory(
        organization=unit.building.organization,
        first_name=name,
        last_name=last_name,
    )
    return Occupancy.objects.create(
        unit=unit,
        person=person,
        role=Occupancy.Role.TENANT,
        start_date=start_date,
    )


def receipt_for(occupancy, *, amount='1250.50'):
    uploader = UserFactory()
    receipt = Receipt.objects.create(
        person=occupancy.person,
        uploaded_by=uploader,
        file_key=f'receipt-{occupancy.id}.pdf',
        file_sha256='a' * 64,
        content_type='application/pdf',
        size_bytes=1024,
        declared_amount=amount,
        transfer_date=date(2026, 10, 5),
    )
    ReceiptAllocation.objects.create(
        receipt=receipt,
        occupancy=occupancy,
        amount=amount,
    )
    return receipt


def latest_event():
    return AuditLog.objects.order_by('-created_at', '-pk').first()


def event_count():
    return AuditLog.objects.count()


def test_issue_settlement_records_event():
    building = BuildingFactory(name='Torre Sur')
    unit = UnitFactory(building=building, number='101', coefficient='1.000000')
    owner_for(unit)
    concept = ExpenseConceptFactory(building=building, name='Limpieza')
    user = employee_for(building)
    settlement = save_draft(building, user, date(2026, 10, 1), {concept: Decimal('48300.00')})
    before = event_count()

    issue_settlement(settlement, user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'settlement.issue'
    assert event.actor_id == user.id
    assert event.target_id == settlement.pk
    assert 'Octubre 2026' in event.summary
    assert 'Torre Sur' in event.summary
    assert '$ 48.300,00' in event.summary


def test_approve_receipt_records_event():
    unit = UnitFactory(number='101')
    occupancy = tenant_for(unit)
    user = employee_for(unit.building)
    receipt = receipt_for(occupancy)
    before = event_count()

    approve_receipt(receipt, user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'receipt.approve'
    assert event.actor_id == user.id
    assert event.target_id == receipt.pk
    assert 'Ana' not in event.summary
    assert 'Lucía Gómez' in event.summary
    assert '101' in event.summary
    assert '$ 1.250,50' in event.summary


def test_reject_receipt_records_event():
    unit = UnitFactory(number='202')
    occupancy = tenant_for(unit, name='Sofía', last_name='Díaz')
    user = employee_for(unit.building)
    receipt = receipt_for(occupancy)
    before = event_count()

    reject_receipt(receipt, user, 'Comprobante ilegible')

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'receipt.reject'
    assert event.actor_id == user.id
    assert event.target_id == receipt.pk
    assert 'Sofía Díaz' in event.summary
    assert '202' in event.summary
    assert 'Comprobante ilegible' in event.summary


def test_record_manual_payment_records_event():
    unit = UnitFactory(number='303')
    occupancy = tenant_for(unit)
    user = employee_for(unit.building)
    before = event_count()

    entry = record_manual_payment(
        occupancy, Decimal('850.00'), date(2026, 10, 8), user, 'Extracto Scotiabank'
    )

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'payment.record_manual'
    assert event.actor_id == user.id
    assert event.target_id == entry.pk
    assert '$ 850,00' in event.summary
    assert '303' in event.summary
    assert 'Extracto Scotiabank' in event.summary


def test_adjust_records_event():
    occupancy = OccupancyFactory(unit__number='404')
    user = employee_for(occupancy.unit.building)
    original = LedgerEntry.objects.create(
        occupancy=occupancy,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.OPENING,
        amount=Decimal('100.00'),
        created_by=user,
    )
    before = event_count()

    adjustment = adjust(original, Decimal('-61.20'), 'Corrección de saldo', user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'ledger.adjust'
    assert event.actor_id == user.id
    assert event.target_id == adjustment.pk
    assert '−$ 61,20' in event.summary
    assert '404' in event.summary


def test_record_opening_records_event():
    occupancy = OccupancyFactory(unit__number='505')
    user = employee_for(occupancy.unit.building)
    before = event_count()

    entry = record_opening(occupancy, Decimal('125.50'), date(2026, 10, 1), user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'ledger.opening'
    assert event.actor_id == user.id
    assert event.target_id == entry.pk
    assert '$ 125,50' in event.summary
    assert '505' in event.summary


def test_sell_unit_records_event():
    unit = UnitFactory(number='606')
    owner_for(unit, name='Vendedor', last_name='Actual')
    buyer = PersonFactory(
        organization=unit.building.organization,
        first_name='Carlos',
        last_name='Comprador',
    )
    user = employee_for(unit.building)
    before = event_count()

    occupancy = sell_unit(unit, buyer, date(2026, 10, 15), user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'occupancy.sell'
    assert event.actor_id == user.id
    assert event.target_id == occupancy.pk
    assert '606' in event.summary
    assert 'Carlos Comprador' in event.summary
    assert '15/10/2026' in event.summary


def test_move_in_records_event():
    unit = UnitFactory(number='707')
    person = PersonFactory(
        organization=unit.building.organization,
        first_name='Mario',
        last_name='Nuevo',
    )
    user = employee_for(unit.building)
    before = event_count()

    occupancy = move_in(unit, person, Occupancy.Role.TENANT, date(2026, 10, 2), user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'occupancy.move_in'
    assert event.actor_id == user.id
    assert event.target_id == occupancy.pk
    assert 'Mario Nuevo' in event.summary
    assert 'inquilino' in event.summary
    assert '707' in event.summary
    assert '02/10/2026' in event.summary


def test_move_out_records_event():
    occupancy = tenant_for(UnitFactory(number='808'), name='Rosa', last_name='Sale')
    user = employee_for(occupancy.unit.building)
    before = event_count()

    result = move_out(occupancy, date(2026, 10, 20), user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'occupancy.move_out'
    assert event.actor_id == user.id
    assert event.target_id == result.pk
    assert 'Rosa Sale' in event.summary
    assert '808' in event.summary
    assert '20/10/2026' in event.summary


def test_replace_tenant_records_event_with_previous_and_new_tenant():
    unit = UnitFactory(number='909')
    tenant_for(unit, name='Inquilino', last_name='Anterior')
    new_person = PersonFactory(
        organization=unit.building.organization,
        first_name='Inquilino',
        last_name='Nuevo',
    )
    user = employee_for(unit.building)
    before = event_count()

    occupancy = replace_tenant(unit, new_person, date(2026, 10, 10), user)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'occupancy.replace_tenant'
    assert event.actor_id == user.id
    assert event.target_id == occupancy.pk
    assert 'Inquilino Anterior' in event.summary
    assert 'Inquilino Nuevo' in event.summary
    assert '10/10/2026' in event.summary


def test_correct_occupancy_records_event_with_changed_fields():
    occupancy = tenant_for(UnitFactory(number='1001'), name='Persona', last_name='Corregida')
    user = employee_for(occupancy.unit.building)
    before = event_count()

    result = correct_occupancy(
        occupancy,
        user,
        start_date=date(2026, 2, 1),
        end_date=date(2026, 10, 31),
    )

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'occupancy.correct'
    assert event.actor_id == user.id
    assert event.target_id == result.pk
    assert '1001' in event.summary
    assert 'start_date' in event.summary
    assert 'end_date' in event.summary


def test_update_person_records_field_names_without_values():
    unit = UnitFactory()
    person = PersonFactory(organization=unit.building.organization)
    user = employee_for(unit.building)
    before = event_count()

    result = update_person(
        person,
        user,
        phone='099 123 456',
        document='4.567.890-1',
    )

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'person.update'
    assert event.actor_id == user.id
    assert event.target_id == result.pk
    assert 'phone' in event.summary
    assert 'document' in event.summary
    payload = json.dumps(event.data)
    assert '099 123 456' not in payload
    assert '4.567.890-1' not in payload
    assert '099 123 456' not in event.summary
    assert '4.567.890-1' not in event.summary


def test_publish_notice_records_event():
    building = BuildingFactory(name='Edificio Central')
    user = employee_for(building)
    before = event_count()

    notice = publish_notice(building, user, 'Corte de agua', 'El servicio se interrumpirá mañana.')

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'notice.publish'
    assert event.actor_id == user.id
    assert event.target_id == notice.pk
    assert 'Corte de agua' in event.summary


def test_set_claim_status_records_event():
    claim = ClaimFactory(title='Pérdida en el sótano')
    user = employee_for(claim.building)
    before = event_count()

    result = set_claim_status(claim, user, Claim.Status.IN_PROGRESS)

    assert AuditLog.objects.count() == before + 1
    event = latest_event()
    assert event.action == 'claim.status'
    assert event.actor_id == user.id
    assert event.target_id == result.pk
    assert 'Pérdida en el sótano' in event.summary
    assert 'En proceso' in event.summary


def test_repeated_approval_creates_no_second_event():
    unit = UnitFactory()
    occupancy = tenant_for(unit)
    user = employee_for(unit.building)
    receipt = receipt_for(occupancy)
    approve_receipt(receipt, user)
    before = event_count()

    with pytest.raises(ValidationError):
        approve_receipt(receipt, user)

    assert event_count() == before


def test_repeated_settlement_issue_creates_no_second_event():
    building = BuildingFactory()
    unit = UnitFactory(building=building, coefficient='1.000000')
    owner_for(unit)
    concept = ExpenseConceptFactory(building=building)
    user = employee_for(building)
    settlement = save_draft(building, user, date(2026, 10, 1), {concept: Decimal('100.00')})
    issue_settlement(settlement, user)
    before = event_count()

    with pytest.raises(ValidationError):
        issue_settlement(settlement, user)

    assert event_count() == before


def test_sale_with_debt_creates_no_event():
    unit = UnitFactory(number='111')
    owner = owner_for(unit)
    user = employee_for(unit.building)
    LedgerEntry.objects.create(
        occupancy=owner,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.OPENING,
        amount=Decimal('100.00'),
        created_by=user,
    )
    buyer = PersonFactory(organization=unit.building.organization)
    before = event_count()

    with pytest.raises(ValidationError):
        sell_unit(unit, buyer, date(2026, 10, 15), user)

    assert event_count() == before


def _assert_no_sensitive_keys(value):
    if isinstance(value, dict):
        for key, nested in value.items():
            assert key not in {'email', 'document', 'phone', 'password'}
            _assert_no_sensitive_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            _assert_no_sensitive_keys(nested)


def test_business_events_never_store_sensitive_data_keys():
    issue_building = BuildingFactory(name='Edificio Auditoría')
    issue_unit = UnitFactory(
        building=issue_building, number='121', coefficient='1.000000'
    )
    owner_for(issue_unit)
    concept = ExpenseConceptFactory(building=issue_building)
    user = employee_for(issue_building)
    settlement = save_draft(
        issue_building, user, date(2026, 10, 1), {concept: Decimal('100.00')}
    )
    issue_settlement(settlement, user)

    tenant = tenant_for(issue_unit, name='Residente', last_name='Pago')
    receipt = receipt_for(tenant, amount='100.00')
    approve_receipt(receipt, user)
    sale_building = BuildingFactory(name='Edificio Venta')
    sale_unit = UnitFactory(
        building=sale_building, number='122', coefficient='1.000000'
    )
    owner_for(sale_unit)
    buyer = PersonFactory(organization=sale_building.organization)
    sale_user = employee_for(sale_building)
    sell_unit(sale_unit, buyer, date(2026, 11, 1), sale_user)
    buyer = PersonFactory(
        organization=sale_building.organization,
        first_name='Comprador',
        last_name='Editado',
    )
    update_person(buyer, sale_user, phone='099 123 456', document='1.234.567-8')

    for event in AuditLog.objects.all():
        _assert_no_sensitive_keys(event.data)
