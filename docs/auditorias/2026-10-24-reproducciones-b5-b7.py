from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import DataError, DatabaseError, IntegrityError, connection, transaction
from django.test import RequestFactory
from django.http import HttpResponse
from django.utils import timezone

from apps.accounts.models import OrgMembership, Organization, User
from apps.audit.context import AuditContextMiddleware, audit_context
from apps.audit.models import RowChange
from apps.buildings.models import ExpenseConcept, Unit
from apps.buildings.services import create_building
from apps.communications.models import Claim, ClaimMessage, Notice, Task
from apps.communications.services import (
    open_claim,
    publish_notice,
    reply_as_resident,
    toggle_task,
)
from apps.ledger.accounts import account_status, overdue_months, periods
from apps.ledger.models import LedgerEntry, Receipt, ReceiptAllocation
from apps.ledger.payments import (
    approve_receipt,
    record_manual_payment,
    reject_receipt,
    submit_receipt,
)
from apps.ledger.services import adjust, record_opening
from apps.people.models import Occupancy, Person
from apps.people.services import (
    correct_occupancy,
    create_person,
    move_in,
    replace_tenant,
    sell_unit,
    update_person,
)
from apps.settlements.models import Settlement, SettlementItem
from apps.settlements.services import delete_draft, issue_settlement, save_draft

pytestmark = pytest.mark.django_db


def _setup_building_with_owner(org=None, coefficients=('1.000000',)):
    org = org or Organization.objects.create(name='Org A')
    building = create_building(org, name='Edificio A', address='Calle 123')
    for idx, coef in enumerate(coefficients, start=1):
        unit = Unit.objects.create(
            building=building,
            number=str(idx),
            floor=1,
            coefficient=Decimal(coef),
        )
        owner = Person.objects.create(
            organization=org,
            first_name=f'Dueño {idx}',
            last_name='Test',
        )
        Occupancy.objects.create(
            unit=unit,
            person=owner,
            role=Occupancy.Role.OWNER,
            start_date=date(2026, 1, 1),
        )
    return org, building


def test_1_issue_settlement_missing_org_membership_check():
    org_a, building_a = _setup_building_with_owner()
    org_b = Organization.objects.create(name='Org B')
    foreign_employee = User.objects.create_user('foreign@orgb.com', 'strong-pass-123')
    OrgMembership.objects.create(user=foreign_employee, organization=org_b)

    concept = building_a.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building_a, date(2026, 10, 1), {concept: Decimal('1000.00')})

    # Un empleado de Org B (o un usuario sin ninguna OrgMembership) puede emitir la liquidación de Org A:
    summary = issue_settlement(settlement, foreign_employee)
    settlement.refresh_from_db()
    assert settlement.status == Settlement.Status.ISSUED
    assert settlement.issued_by == foreign_employee
    assert summary.total_distributed == Decimal('1000.00')
    assert LedgerEntry.objects.filter(settlement=settlement, created_by=foreign_employee).count() == 1


def test_2_approve_receipt_cross_org_and_unvalidated_default_allocations():
    org_a, building_a = _setup_building_with_owner()
    org_b, building_b = _setup_building_with_owner(Organization.objects.create(name='Org B'))

    emp_a = User.objects.create_user('emp_a@orga.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp_a, organization=org_a)
    emp_b = User.objects.create_user('emp_b@orgb.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp_b, organization=org_b)

    person_a = building_a.units.first().occupancies.first().person
    occ_a = building_a.units.first().occupancies.first()
    occ_b = building_b.units.first().occupancies.first()

    # Comprobante cuya persona es de Org A, pero cuya ReceiptAllocation apunta a una ocupación de Org B
    # y por un monto ($100.00) que ni siquiera coincide con declared_amount ($5000.00):
    receipt = submit_receipt(
        person_a,
        emp_a,
        file_key='receipts/cross-org',
        file_sha256='a' * 64,
        content_type='application/pdf',
        size_bytes=500,
        declared_amount=Decimal('5000.00'),
        transfer_date=date(2026, 10, 20),
        allocations={occ_a: Decimal('5000.00')},
    )
    ReceiptAllocation.objects.filter(receipt=receipt).update(
        occupancy=occ_b,
        amount=Decimal('100.00'),
    )

    # 1) El empleado de Org A ni siquiera puede aprobar el comprobante de su propia persona (PermissionDenied),
    # mientras que el empleado de Org B SÍ puede aprobarlo y acredita $100.00 (distinto de $5000.00) en occ_b:
    with pytest.raises(PermissionDenied):
        approve_receipt(receipt, emp_a)

    entries = approve_receipt(receipt, emp_b)
    receipt.refresh_from_db()
    assert receipt.status == Receipt.Status.APPROVED
    assert len(entries) == 1
    assert entries[0].occupancy == occ_b
    assert entries[0].amount == Decimal('-100.00')


def test_3_audit_context_wipes_request_ip_path_and_leaks_actor_in_transaction():
    org_a, building_a = _setup_building_with_owner()
    org_b = Organization.objects.create(name='Org B')
    emp_a = User.objects.create_user('emp@orga.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp_a, organization=org_a)

    # 1) Dentro de un request envuelto por AuditContextMiddleware, llamar a cualquier servicio
    # (ej. publish_notice) pisa app.request_ip y app.request_path con '':
    rf = RequestFactory()
    request = rf.post('/api/buildings/notices/', REMOTE_ADDR='203.0.113.55')
    request.user = emp_a

    captured = {}

    def view(req):
        captured['notice'] = publish_notice(
            building_a, req.user, 'Corte de agua', 'Mañana de 8 a 12 hs sin agua.'
        )
        # Escritura posterior en la misma vista (fuera del audit_context interno del servicio):
        captured['person_after'] = create_person(
            org_b, first_name='Otra', last_name='Org'
        )
        return HttpResponse('ok')

    middleware = AuditContextMiddleware(view)
    middleware(request)

    notice_change = RowChange.objects.get(
        table_name='communications_notice',
        row_id=captured['notice'].id,
        operation=RowChange.Operation.INSERT,
    )
    assert notice_change.actor == emp_a
    assert notice_change.request_ip == ''
    assert notice_change.request_path == ''

    # 2) Y al salir de audit_context dentro de una transacción abierta, el actor y la organización
    # quedan pegados para escrituras posteriores que ocurren SIN audit_context:
    with transaction.atomic():
        with audit_context(emp_a, organization=org_a, ip='198.51.100.1', path='/interno'):
            pass
        # Fuera de audit_context: esta escritura no tiene actor y es de org_b,
        # pero queda registrada con actor=emp_a y organization_id=org_a.id!
        leaked_person = create_person(org_b, first_name='Sin', last_name='Contexto')

    leaked_change = RowChange.objects.get(
        table_name='people_person',
        row_id=leaked_person.id,
        operation=RowChange.Operation.INSERT,
    )
    assert leaked_change.actor == emp_a
    assert leaked_change.organization_id == org_a.id
    assert leaked_change.request_ip == '198.51.100.1'
    assert leaked_change.request_path == '/interno'


def test_4_fifo_adjustments_misapplied_and_sin_cargar_hides_current_debt():
    org, building = _setup_building_with_owner()
    emp = User.objects.create_user('emp@fifo.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp, organization=org)
    occ = building.units.first().occupancies.first()
    concept = building.concepts.get(name='O.S.E. (agua)')

    # Emitimos agosto ($1000) y octubre ($1000). El residente NO pagó agosto.
    s_aug = save_draft(building, date(2026, 8, 1), {concept: Decimal('1000.00')})
    issue_settlement(s_aug, emp)
    s_oct = save_draft(building, date(2026, 10, 1), {concept: Decimal('1000.00')})
    issue_settlement(s_oct, emp)
    charge_oct = LedgerEntry.objects.get(settlement=s_oct, occupancy=occ)

    assert account_status(occ, date(2026, 10, 1)) == 'moroso'
    assert overdue_months(occ, date(2026, 10, 1)) == [date(2026, 8, 1)]

    # 1) Anulamos el cargo de OCTUBRE con un ajuste negativo (-$1000) apuntando a charge_oct.
    # En vez de cancelar octubre, FIFO mete los $1000 en credit_pool y da por pagado AGOSTO:
    adjust(charge_oct, Decimal('-1000.00'), 'Anula cargo de octubre por error', emp)

    per = {p.month: p for p in periods(occ)}
    assert per[date(2026, 8, 1)].outstanding == Decimal('0.00')
    assert per[date(2026, 10, 1)].outstanding == Decimal('1000.00')
    assert overdue_months(occ, date(2026, 10, 1)) == []
    assert account_status(occ, date(2026, 10, 1)) == 'pendiente'

    # 2) En otra unidad, aún no se emitió la liquidación de noviembre (2026-11-01),
    # pero la ocupación tiene un recargo o saldo inicial de $500 en noviembre:
    _, building2 = _setup_building_with_owner(org)
    occ2 = building2.units.first().occupancies.first()
    record_opening(occ2, Decimal('500.00'), date(2026, 11, 1), emp)
    # Pese a tener saldo > 0 ($500.00), account_status devuelve 'sin-cargar' en vez de 'pendiente':
    assert account_status(occ2, date(2026, 11, 1)) == 'sin-cargar'


def test_5_issue_settlement_negative_rounding_difference_crashes_with_runtime_error():
    # Edificio de 16 unidades iguales (0.062500 cada una, como Pocitos)
    org, building = _setup_building_with_owner(coefficients=tuple(['0.062500'] * 16))
    emp = User.objects.create_user('emp@round.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp, organization=org)
    concept = building.concepts.get(name='O.S.E. (agua)')

    # Monto = $0.08 -> cada unidad tiene base = 0.08 * 0.0625 = 0.005 -> redondea a $0.01 (ROUND_HALF_UP).
    # distributed = 16 * 0.01 = 0.16; difference = 0.08 - 0.16 = -0.08.
    # target['amount'] = 0.01 + (-0.08) = -0.07 <= 0 -> se saltea en `if candidate['amount'] <= 0: continue`
    # y la emisión explota con RuntimeError!
    settlement = save_draft(building, date(2026, 10, 1), {concept: Decimal('0.08')})
    with pytest.raises(RuntimeError, match='no coincide con el total'):
        issue_settlement(settlement, emp)


def test_6_replace_tenant_and_sell_unit_same_day_crash_and_duplicate_owner():
    org, building = _setup_building_with_owner()
    emp = User.objects.create_user('emp@people.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp, organization=org)
    unit = building.units.first()

    t1 = create_person(org, first_name='Inq', last_name='Uno')
    t2 = create_person(org, first_name='Inq', last_name='Dos')
    t3 = create_person(org, first_name='Inq', last_name='Tres')

    # 1) Cambiar de inquilino dos veces seguidas en la misma fecha (o el mismo día de ingreso)
    # deja end_date = start_date - 1 día y lanza IntegrityError no manejado:
    replace_tenant(unit, t1, date(2026, 3, 15), emp)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            replace_tenant(unit, t2, date(2026, 3, 15), emp)

    # 2) Vender la unidad al MISMO propietario actual no se rechaza (duplica la ocupación de dueño),
    # y vender dos veces en la misma fecha lanza IntegrityError no manejado:
    current_owner = unit.occupancies.get(role=Occupancy.Role.OWNER).person
    dup_owner_occ = sell_unit(unit, current_owner, date(2026, 3, 15), emp)
    assert dup_owner_occ.person == current_owner
    assert unit.occupancies.filter(role=Occupancy.Role.OWNER, person=current_owner).count() == 2

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            sell_unit(unit, t3, date(2026, 3, 15), emp)

    # 3) move_in acepta cualquier string inválido en `role` porque ni el servicio ni el modelo lo validan:
    weird_occ = move_in(unit, t2, 'intruso', date(2026, 4, 1), emp)
    assert weird_occ.role == 'intruso'


def test_7_ex_tenant_can_reply_claims_and_null_user_id_bypass_and_subcent_payments():
    org, building = _setup_building_with_owner()
    emp = User.objects.create_user('emp@comm.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp, organization=org)
    unit = building.units.first()

    # 1) Un inquilino abre un reclamo, luego se muda (end_date en el pasado y saldo 0),
    # pero reply_as_resident no verifica ocupación vigente y le permite seguir respondiendo:
    ex_user = User.objects.create_user('extenant@test.com', 'strong-pass-123')
    ex_person = create_person(org, first_name='Ex', last_name='Inquilino', email='extenant@test.com')
    ex_person.user = ex_user
    ex_person.save(update_fields=['user', 'updated_at'])

    occ = Occupancy.objects.create(
        unit=unit,
        person=ex_person,
        role=Occupancy.Role.TENANT,
        start_date=timezone.localdate() - timedelta(days=30),
        end_date=None,
    )
    claim = open_claim(ex_person, unit, Claim.Kind.COMPLAINT, 'Humedad', 'En el techo', ex_user)

    # El inquilino se mudó ayer (ocupación cerrada y sin deuda):
    occ.end_date = timezone.localdate() - timedelta(days=1)
    occ.save(update_fields=['end_date', 'updated_at'])

    msg = reply_as_resident(claim, ex_person, ex_user, 'Sigo comentando aunque ya no vivo acá.')
    assert msg.pk is not None

    # 2) Persona sin usuario (person.user_id is None, N7) + AnonymousUser (user.id is None):
    # `person.user_id != user.id` evalúa `None != None` -> False, salteando PermissionDenied,
    # y `audit_context(anon)` setea `app.actor_id = 'None'`, haciendo explotar el trigger con DataError!
    person_no_account = unit.occupancies.get(role=Occupancy.Role.OWNER).person
    assert person_no_account.user_id is None
    anon = AnonymousUser()
    assert anon.id is None
    with pytest.raises(DataError, match='invalid input syntax for type uuid: "None"'):
        with transaction.atomic():
            open_claim(person_no_account, unit, Claim.Kind.REPORT, 'Fuga', 'Detalle', anon)

    # 3) En submit_receipt y approve_receipt, montos con 3 decimales que suman declared_amount en Python
    # se redondean en Postgres y crean asientos payment cuya suma ($9.99) no coincide con declared_amount ($10.00):
    Unit.objects.filter(pk=unit.pk).update(coefficient=Decimal('0.800000'))
    u2 = Unit.objects.create(building=building, number='2', floor=1, coefficient=Decimal('0.100000'))
    u3 = Unit.objects.create(building=building, number='3', floor=1, coefficient=Decimal('0.100000'))
    occ1 = unit.occupancies.get(role=Occupancy.Role.OWNER)
    occ2 = Occupancy.objects.create(unit=u2, person=person_no_account, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1))
    occ3 = Occupancy.objects.create(unit=u3, person=person_no_account, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1))

    receipt = submit_receipt(
        person_no_account,
        emp,
        file_key='receipts/subcent-mismatch',
        file_sha256='b' * 64,
        content_type='application/pdf',
        size_bytes=100,
        declared_amount=Decimal('10.00'),
        transfer_date=date(2026, 10, 20),
        allocations={
            occ1: Decimal('3.334'),
            occ2: Decimal('3.334'),
            occ3: Decimal('3.332'),
        },
        note='Tres unidades',
    )
    entries = approve_receipt(receipt, emp)
    total_credited = sum((-e.amount for e in entries), Decimal('0.00'))
    assert receipt.declared_amount == Decimal('10.00')
    assert total_credited == Decimal('9.99')


def test_8_truncate_business_tables_leaves_zero_audit_rowchange():
    org, building = _setup_building_with_owner()
    emp = User.objects.create_user('emp@trunc.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp, organization=org)
    notice = publish_notice(building, emp, 'Aviso importante', 'Cuerpo del aviso importante.')

    assert Notice.objects.filter(pk=notice.pk).exists()
    with connection.cursor() as cursor:
        cursor.execute('SET CONSTRAINTS ALL IMMEDIATE')
        cursor.execute('TRUNCATE communications_notice')

    assert Notice.objects.count() == 0
    assert not RowChange.objects.filter(
        table_name='communications_notice',
        operation=RowChange.Operation.DELETE,
    ).exists()
