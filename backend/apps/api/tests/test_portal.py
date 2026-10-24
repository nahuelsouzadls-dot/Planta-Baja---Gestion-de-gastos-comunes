import json
from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import OrgMembership, Organization, User
from apps.api.testing import api_client_for, assert_cross_org_404
from apps.audit.models import AuditLog, RowChange
from apps.buildings.models import Building, ExpenseConcept, Unit
from apps.buildings.services import create_building
from apps.communications.models import Claim, ClaimMessage, Notice
from apps.ledger.models import LedgerEntry, Receipt, ReceiptAllocation
from apps.ledger.payments import reject_receipt, submit_receipt
from apps.people.models import Occupancy, Person
from apps.settlements.models import Settlement


pytestmark = pytest.mark.django_db


PORTAL_ROUTE_NAMES = (
    'account',
    'months',
    'settlement',
    'movements',
    'receipts',
    'notices',
    'claims_list',
    'claims_create',
    'claim_detail',
    'claim_reply',
)

MONEY_KEYS = {
    'amount',
    'balance',
    'building_total',
    'charge',
    'charged',
    'coefficient',
    'credit',
    'debit',
    'declared_amount',
    'outstanding',
    'total',
}


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo', golden='/golden/demo.json')
    return Organization.objects.get()


def walk_json(value, path=()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk_json(item, path + (str(key),))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_json(item, path + (str(index),))
    else:
        yield path, value


def test_demo_juan_perez_and_maria_garcia_portal_views(demo):
    minas = demo.buildings.get(name='Edificio Minas')
    juan_user = User.objects.get(email='juan.perez@correo.com.uy')
    maria_user = User.objects.get(email='maria.garcia@correo.com.uy')

    juan_occ = minas.units.get(number='101').occupancies.get(role=Occupancy.Role.OWNER)
    maria_occ = minas.units.get(number='102').occupancies.get(role=Occupancy.Role.TENANT)

    juan_client = api_client_for(juan_user)
    account_resp = juan_client.get(f'/api/v1/portal/occupancies/{juan_occ.pk}/account?month=2026-10')
    assert account_resp.status_code == 200
    account = account_resp.json()
    assert account['first_name'] == 'Juan'
    assert account['name'] == 'Juan Pérez'
    assert account['unit'] == '101'
    assert account['role'] == 'owner'
    assert account['role_note'] == ''
    assert account['status'] == 'pendiente'
    assert account['balance'] == '4153.80'
    assert account['charge'] == '4153.80'
    assert account['overdue_months'] == []
    assert account['due_day'] == 10
    assert account['pending_receipt'] is None
    assert account['closed'] is False
    assert account['concept'] == 'Apto 101'
    assert account['bank']['concept'] == 'Apto 101'
    assert account['bank']['bank_name'] == 'Scotiabank'
    assert account['bank']['holder'] == 'Confort S.A.'

    months_resp = juan_client.get(f'/api/v1/portal/occupancies/{juan_occ.pk}/months?month=2026-10')
    assert months_resp.status_code == 200
    months = months_resp.json()['months']
    assert [m['month'] for m in months] == ['2026-10', '2026-09', '2026-08', '2026-07']
    assert {m['month']: m['status'] for m in months} == {
        '2026-07': 'ok',
        '2026-08': 'ok',
        '2026-09': 'ok',
        '2026-10': 'warn',
    }

    settlement_resp = juan_client.get(
        f'/api/v1/portal/occupancies/{juan_occ.pk}/settlements/2026-10'
    )
    assert settlement_resp.status_code == 200
    settlement = settlement_resp.json()
    assert settlement['total'] == '4153.80'
    assert settlement['coefficient'] == '0.086000'
    assert len(settlement['lines']) == 6
    extra_line = next(
        line for line in settlement['lines'] if line['concept'] == 'Cuota extraordinaria'
    )
    assert extra_line['detail'] == 'Impermeabilización de azotea (cuota 1 de 3)'
    assert extra_line['amount'] == '1032.00'
    assert extra_line['total'] == '12000.00'

    unissued_resp = juan_client.get(
        f'/api/v1/portal/occupancies/{juan_occ.pk}/settlements/2026-11'
    )
    assert unissued_resp.status_code == 404

    maria_client = api_client_for(maria_user)
    maria_account_resp = maria_client.get(
        f'/api/v1/portal/occupancies/{maria_occ.pk}/account?month=2026-10'
    )
    assert maria_account_resp.status_code == 200
    maria_account = maria_account_resp.json()
    assert maria_account['status'] == 'revision'
    assert maria_account['role'] == 'tenant'
    assert maria_account['role_note'] == 'pagás los gastos comunes'
    assert maria_account['pending_receipt'] is not None
    assert maria_account['pending_receipt']['file'] == 'comprobante_oct2026.jpg'
    assert maria_account['pending_receipt']['date'] == '2026-10-10'
    assert maria_account['pending_receipt']['amount'] == '2614.50'


@pytest.fixture
def portal_isolation_env():
    org_a = Organization.objects.create(name='Confort S.A.')
    org_b = Organization.objects.create(name='Otra Administración')

    employee = User.objects.create_user('emp@confort.demo', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=org_a)

    foreign_employee = User.objects.create_user('emp@otra.demo', password='password-12345')
    OrgMembership.objects.create(user=foreign_employee, organization=org_b)

    building_a1 = create_building(
        org_a, employee, name='Edificio Minas', address='Minas 1450', due_day=10
    )
    building_a2 = create_building(
        org_a, employee, name='Edificio Centro', address='Colonia 1000', due_day=10
    )
    building_b = create_building(
        org_b, foreign_employee, name='Edificio Ajeno', address='Rivera 2000', due_day=10
    )

    unit_101 = Unit.objects.create(
        building=building_a1, number='101', floor=1, coefficient=Decimal('0.500000')
    )
    unit_102 = Unit.objects.create(
        building=building_a1, number='102', floor=1, coefficient=Decimal('0.500000')
    )
    unit_a2 = Unit.objects.create(
        building=building_a2, number='201', floor=2, coefficient=Decimal('1.000000')
    )
    unit_b = Unit.objects.create(
        building=building_b, number='301', floor=3, coefficient=Decimal('1.000000')
    )

    owner_user = User.objects.create_user(
        'juan@residentes.demo', password='password-12345', first_name='Juan', last_name='Pérez'
    )
    other_unit_user = User.objects.create_user(
        'vecino@residentes.demo', password='password-12345', first_name='Ana', last_name='Gómez'
    )
    other_building_user = User.objects.create_user(
        'otro.edificio@residentes.demo',
        password='password-12345',
        first_name='Luis',
        last_name='Sosa',
    )
    other_org_user = User.objects.create_user(
        'otra.org@residentes.demo',
        password='password-12345',
        first_name='Carla',
        last_name='Díaz',
    )

    owner_person = Person.objects.create(
        organization=org_a,
        first_name='Juan',
        last_name='Pérez',
        email='juan@residentes.demo',
        user=owner_user,
    )
    other_unit_person = Person.objects.create(
        organization=org_a,
        first_name='Ana',
        last_name='Gómez',
        email='vecino@residentes.demo',
        user=other_unit_user,
    )
    other_building_person = Person.objects.create(
        organization=org_a,
        first_name='Luis',
        last_name='Sosa',
        email='otro.edificio@residentes.demo',
        user=other_building_user,
    )
    other_org_person = Person.objects.create(
        organization=org_b,
        first_name='Carla',
        last_name='Díaz',
        email='otra.org@residentes.demo',
        user=other_org_user,
    )

    target_occ = Occupancy.objects.create(
        unit=unit_101,
        person=owner_person,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 1, 1),
    )
    Occupancy.objects.create(
        unit=unit_102,
        person=other_unit_person,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 1, 1),
    )
    Occupancy.objects.create(
        unit=unit_a2,
        person=other_building_person,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 1, 1),
    )
    Occupancy.objects.create(
        unit=unit_b,
        person=other_org_person,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 1, 1),
    )

    settlement = Settlement.objects.create(
        building=building_a1,
        month=date(2026, 10, 1),
        status=Settlement.Status.DRAFT,
    )
    concept = building_a1.concepts.filter(kind=ExpenseConcept.Kind.ORDINARY).first()
    settlement.items.create(concept=concept, amount=Decimal('2000.00'))
    settlement.status = Settlement.Status.ISSUED
    settlement.issued_by = employee
    settlement.issued_at = datetime(2026, 10, 1, tzinfo=dt_timezone.utc)
    settlement.save(update_fields=['status', 'issued_by', 'issued_at', 'updated_at'])
    LedgerEntry.objects.create(
        occupancy=target_occ,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.CHARGE,
        amount=Decimal('1000.00'),
        settlement=settlement,
        concept=concept,
        created_by=employee,
        base_amount=Decimal('1000.00'),
        coefficient=Decimal('0.500000'),
        days=31,
        days_in_month=31,
    )

    claim = Claim.objects.create(
        building=building_a1,
        unit=unit_101,
        author=owner_person,
        kind=Claim.Kind.REPORT,
        title='Reclamo propio de Juan',
        status=Claim.Status.PENDING,
    )
    ClaimMessage.objects.create(
        claim=claim,
        author=owner_user,
        from_admin=False,
        text='Mensaje inicial',
    )

    routes = {
        'account': ('get', f'/api/v1/portal/occupancies/{target_occ.pk}/account', None),
        'months': ('get', f'/api/v1/portal/occupancies/{target_occ.pk}/months', None),
        'settlement': (
            'get',
            f'/api/v1/portal/occupancies/{target_occ.pk}/settlements/2026-10',
            None,
        ),
        'movements': ('get', f'/api/v1/portal/occupancies/{target_occ.pk}/movements', None),
        'receipts': ('get', f'/api/v1/portal/occupancies/{target_occ.pk}/receipts', None),
        'notices': ('get', f'/api/v1/portal/occupancies/{target_occ.pk}/notices', None),
        'claims_list': ('get', f'/api/v1/portal/occupancies/{target_occ.pk}/claims', None),
        'claims_create': (
            'post',
            f'/api/v1/portal/occupancies/{target_occ.pk}/claims',
            {'kind': 'report', 'title': 'Intento ajeno', 'body': 'Detalle'},
        ),
        'claim_detail': ('get', f'/api/v1/portal/claims/{claim.pk}', None),
        'claim_reply': (
            'post',
            f'/api/v1/portal/claims/{claim.pk}/replies',
            {'text': 'Respuesta ajena'},
        ),
    }
    return {
        'routes': routes,
        'owner_user': owner_user,
        'other_unit_user': other_unit_user,
        'other_building_user': other_building_user,
        'other_org_user': other_org_user,
        'employee': employee,
    }


@pytest.mark.parametrize('route_name', PORTAL_ROUTE_NAMES)
def test_portal_isolation_across_unit_building_organization_employee_and_anonymous(
    route_name, portal_isolation_env
):
    method, url, payload = portal_isolation_env['routes'][route_name]
    kwargs = {'data': payload, 'format': 'json'} if payload is not None else {}

    for foreign_key in ('other_unit_user', 'other_building_user', 'other_org_user'):
        foreign_client = api_client_for(portal_isolation_env[foreign_key])
        assert_cross_org_404(foreign_client, url, method=method, **kwargs)

    employee_client = api_client_for(portal_isolation_env['employee'])
    emp_resp = getattr(employee_client, method)(url, **kwargs)
    assert emp_resp.status_code == 403

    anon_client = APIClient(enforce_csrf_checks=True)
    anon_resp = getattr(anon_client, method)(url, **kwargs)
    assert anon_resp.status_code == 403


def test_ex_tenant_n17_with_debt_and_without_debt():
    org = Organization.objects.create(name='Confort S.A.')
    employee = User.objects.create_user('emp@confort.demo', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=org)
    building = create_building(org, employee, name='Edificio Sur', address='Sur 100')
    unit_debt = Unit.objects.create(
        building=building, number='101', floor=1, coefficient=Decimal('0.500000')
    )
    unit_settled = Unit.objects.create(
        building=building, number='102', floor=1, coefficient=Decimal('0.500000')
    )

    debtor_user = User.objects.create_user(
        'ex.deudor@example.com', password='password-12345', first_name='Ex', last_name='Deudor'
    )
    settled_user = User.objects.create_user(
        'ex.saldado@example.com', password='password-12345', first_name='Ex', last_name='Saldado'
    )
    debtor_person = Person.objects.create(
        organization=org,
        first_name='Ex',
        last_name='Deudor',
        email='ex.deudor@example.com',
        user=debtor_user,
    )
    settled_person = Person.objects.create(
        organization=org,
        first_name='Ex',
        last_name='Saldado',
        email='ex.saldado@example.com',
        user=settled_user,
    )

    exit_date = date(2026, 8, 31)
    debtor_occ = Occupancy.objects.create(
        unit=unit_debt,
        person=debtor_person,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 1, 1),
        end_date=exit_date,
    )
    settled_occ = Occupancy.objects.create(
        unit=unit_settled,
        person=settled_person,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 1, 1),
        end_date=exit_date,
    )

    settlement_aug = Settlement.objects.create(
        building=building,
        month=date(2026, 8, 1),
        status=Settlement.Status.DRAFT,
    )
    concept = building.concepts.filter(kind=ExpenseConcept.Kind.ORDINARY).first()
    settlement_aug.items.create(concept=concept, amount=Decimal('1000.00'))
    settlement_aug.status = Settlement.Status.ISSUED
    settlement_aug.issued_by = employee
    settlement_aug.issued_at = datetime(2026, 8, 1, tzinfo=dt_timezone.utc)
    settlement_aug.save(update_fields=['status', 'issued_by', 'issued_at', 'updated_at'])

    LedgerEntry.objects.create(
        occupancy=debtor_occ,
        date=date(2026, 8, 1),
        kind=LedgerEntry.Kind.CHARGE,
        amount=Decimal('500.00'),
        settlement=settlement_aug,
        concept=concept,
        created_by=employee,
        base_amount=Decimal('500.00'),
        coefficient=Decimal('0.500000'),
        days=31,
        days_in_month=31,
    )

    receipt = submit_receipt(
        debtor_person,
        debtor_user,
        file_key='ex-deudor-ago.pdf',
        file_sha256='c' * 64,
        content_type='application/pdf',
        size_bytes=512,
        declared_amount=Decimal('500.00'),
        transfer_date=date(2026, 8, 10),
        allocations={debtor_occ: Decimal('500.00')},
    )
    reject_receipt(receipt, employee, 'Comprobante ilegible')

    notice_before = Notice.objects.create(
        building=building,
        title='Aviso de agosto',
        body='Publicado mientras el inquilino vivía en el edificio.',
        published_by=employee,
    )
    Notice.objects.filter(pk=notice_before.pk).update(
        created_at=datetime(2026, 8, 15, 12, 0, tzinfo=dt_timezone.utc)
    )
    notice_after = Notice.objects.create(
        building=building,
        title='Aviso de octubre',
        body='Publicado después de la salida del ex inquilino.',
        published_by=employee,
    )
    Notice.objects.filter(pk=notice_after.pk).update(
        created_at=datetime(2026, 10, 15, 12, 0, tzinfo=dt_timezone.utc)
    )

    old_claim = Claim.objects.create(
        building=building,
        unit=unit_debt,
        author=debtor_person,
        kind=Claim.Kind.REPORT,
        title='Reclamo previo a la salida',
        status=Claim.Status.IN_PROGRESS,
    )
    Claim.objects.filter(pk=old_claim.pk).update(
        created_at=datetime(2026, 8, 10, 10, 0, tzinfo=dt_timezone.utc)
    )

    debtor_client = api_client_for(debtor_user)
    acc_resp = debtor_client.get(f'/api/v1/portal/occupancies/{debtor_occ.pk}/account?month=2026-10')
    assert acc_resp.status_code == 200
    assert acc_resp.json()['closed'] is True
    assert acc_resp.json()['balance'] == '500.00'

    mov_resp = debtor_client.get(f'/api/v1/portal/occupancies/{debtor_occ.pk}/movements')
    assert mov_resp.status_code == 200
    assert len(mov_resp.json()['movements']) == 1

    rec_resp = debtor_client.get(f'/api/v1/portal/occupancies/{debtor_occ.pk}/receipts')
    assert rec_resp.status_code == 200
    assert len(rec_resp.json()['receipts']) == 1
    assert rec_resp.json()['receipts'][0]['status'] == 'rejected'
    assert rec_resp.json()['receipts'][0]['reason'] == 'Comprobante ilegible'

    not_resp = debtor_client.get(f'/api/v1/portal/occupancies/{debtor_occ.pk}/notices')
    assert not_resp.status_code == 200
    titles = [item['title'] for item in not_resp.json()['notices']]
    assert titles == ['Aviso de agosto']

    open_claim_resp = debtor_client.post(
        f'/api/v1/portal/occupancies/{debtor_occ.pk}/claims',
        {'kind': 'report', 'title': 'Reclamo fuera de plazo', 'body': 'Detalle'},
        format='json',
    )
    assert open_claim_resp.status_code in (400, 403)
    assert 'no ocupa actualmente' in open_claim_resp.json()['detail']

    reply_claim_resp = debtor_client.post(
        f'/api/v1/portal/claims/{old_claim.pk}/replies',
        {'text': 'Intento responder siendo ex inquilino'},
        format='json',
    )
    assert reply_claim_resp.status_code in (400, 403)
    assert 'no ocupa actualmente' in reply_claim_resp.json()['detail']

    settled_claim = Claim.objects.create(
        building=building,
        unit=unit_settled,
        author=settled_person,
        kind=Claim.Kind.REPORT,
        title='Reclamo de ex inquilino sin deuda',
        status=Claim.Status.PENDING,
    )
    settled_client = api_client_for(settled_user)
    settled_routes = [
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/account', None),
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/months', None),
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/settlements/2026-08', None),
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/movements', None),
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/receipts', None),
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/notices', None),
        ('get', f'/api/v1/portal/occupancies/{settled_occ.pk}/claims', None),
        (
            'post',
            f'/api/v1/portal/occupancies/{settled_occ.pk}/claims',
            {'kind': 'report', 'title': 'Intento sin deuda', 'body': 'Detalle'},
        ),
        ('get', f'/api/v1/portal/claims/{settled_claim.pk}', None),
        (
            'post',
            f'/api/v1/portal/claims/{settled_claim.pk}/replies',
            {'text': 'Intento sin deuda'},
        ),
    ]
    for method, url, payload in settled_routes:
        kwargs = {'data': payload, 'format': 'json'} if payload is not None else {}
        resp = getattr(settled_client, method)(url, **kwargs)
        assert resp.status_code == 404, (method, url, resp.status_code)


def test_multiple_occupancies_do_not_mix_balances_and_split_receipts():
    org = Organization.objects.create(name='Confort S.A.')
    employee = User.objects.create_user('emp@confort.demo', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=org)

    building_1 = create_building(org, employee, name='Edificio Uno', address='Uno 100')
    building_2 = create_building(org, employee, name='Edificio Dos', address='Dos 200')
    unit_1 = Unit.objects.create(
        building=building_1, number='101', floor=1, coefficient=Decimal('1.000000')
    )
    unit_2 = Unit.objects.create(
        building=building_2, number='202', floor=2, coefficient=Decimal('1.000000')
    )

    multi_user = User.objects.create_user(
        'multi@residentes.demo', password='password-12345', first_name='Martín', last_name='Plural'
    )
    person = Person.objects.create(
        organization=org,
        first_name='Martín',
        last_name='Plural',
        email='multi@residentes.demo',
        user=multi_user,
    )
    occ_1 = Occupancy.objects.create(
        unit=unit_1, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1)
    )
    occ_2 = Occupancy.objects.create(
        unit=unit_2, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1)
    )

    LedgerEntry.objects.create(
        occupancy=occ_1,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.OPENING,
        amount=Decimal('1200.00'),
        created_by=employee,
    )
    LedgerEntry.objects.create(
        occupancy=occ_2,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.OPENING,
        amount=Decimal('3500.50'),
        created_by=employee,
    )

    submit_receipt(
        person,
        multi_user,
        file_key='pago-compartido.pdf',
        file_sha256='d' * 64,
        content_type='application/pdf',
        size_bytes=1024,
        declared_amount=Decimal('4700.50'),
        transfer_date=date(2026, 10, 12),
        note='1200 para 101 y 3500.50 para 202',
        allocations={occ_1: Decimal('1200.00'), occ_2: Decimal('3500.50')},
    )

    client = api_client_for(multi_user)
    occ_list = client.get('/api/v1/portal/occupancies').json()
    assert {item['id'] for item in occ_list} == {str(occ_1.pk), str(occ_2.pk)}

    acc_1 = client.get(f'/api/v1/portal/occupancies/{occ_1.pk}/account').json()
    acc_2 = client.get(f'/api/v1/portal/occupancies/{occ_2.pk}/account').json()
    assert acc_1['unit'] == '101'
    assert acc_1['balance'] == '1200.00'
    assert acc_1['pending_receipt']['amount'] == '1200.00'

    assert acc_2['unit'] == '202'
    assert acc_2['balance'] == '3500.50'
    assert acc_2['pending_receipt']['amount'] == '3500.50'

    rec_1 = client.get(f'/api/v1/portal/occupancies/{occ_1.pk}/receipts').json()['receipts']
    rec_2 = client.get(f'/api/v1/portal/occupancies/{occ_2.pk}/receipts').json()['receipts']
    assert rec_1[0]['amount'] == '1200.00'
    assert rec_1[0]['declared_amount'] == '4700.50'
    assert rec_2[0]['amount'] == '3500.50'
    assert rec_2[0]['declared_amount'] == '4700.50'


def test_portal_responses_never_expose_other_peoples_data_or_secrets(demo):
    minas = demo.buildings.get(name='Edificio Minas')
    juan_user = User.objects.get(email='juan.perez@correo.com.uy')
    maria_employee = User.objects.get(email='maria@confort.demo')
    juan_occ = minas.units.get(number='101').occupancies.get(role=Occupancy.Role.OWNER)
    juan_claim = Claim.objects.get(unit=juan_occ.unit, author=juan_occ.person)

    from apps.communications.services import reply_as_admin

    reply_as_admin(juan_claim, maria_employee, 'Mañana cambiamos la lámpara.')

    other_people = Person.objects.exclude(pk=juan_occ.person_id)
    forbidden_strings = {
        'password',
        'token_hash',
        'argon2',
        maria_employee.email.lower(),
        'pablo@confort.demo',
    }
    for other in other_people:
        if other.email:
            forbidden_strings.add(other.email.lower())
        if other.phone:
            forbidden_strings.add(other.phone.lower())
        if other.document:
            forbidden_strings.add(other.document.lower())
        forbidden_strings.add(str(other).lower())

    client = api_client_for(juan_user)
    endpoints = [
        f'/api/v1/portal/occupancies/{juan_occ.pk}/account?month=2026-10',
        f'/api/v1/portal/occupancies/{juan_occ.pk}/months?month=2026-10',
        f'/api/v1/portal/occupancies/{juan_occ.pk}/settlements/2026-10',
        f'/api/v1/portal/occupancies/{juan_occ.pk}/movements',
        f'/api/v1/portal/occupancies/{juan_occ.pk}/receipts',
        f'/api/v1/portal/occupancies/{juan_occ.pk}/notices',
        f'/api/v1/portal/occupancies/{juan_occ.pk}/claims',
        f'/api/v1/portal/claims/{juan_claim.pk}',
    ]
    for url in endpoints:
        resp = client.get(url)
        assert resp.status_code == 200, url
        payload = resp.json()
        serialized = json.dumps(payload, ensure_ascii=False).lower()
        for forbidden in forbidden_strings:
            if forbidden:
                assert forbidden not in serialized, f'{forbidden!r} leaked in {url}'
        for path, _ in walk_json(payload):
            key = path[-1].lower() if path else ''
            assert key not in {'email', 'phone', 'document', 'password', 'token_hash'}, (
                f'forbidden key {key!r} in {url}'
            )

    claim_detail = client.get(f'/api/v1/portal/claims/{juan_claim.pk}').json()
    admin_messages = [m for m in claim_detail['messages'] if m['from_admin']]
    assert admin_messages
    assert admin_messages[0]['author'] == 'María Fernández'


def test_portal_amounts_are_strings_and_queries_are_constant_for_6_and_12_movements():
    org = Organization.objects.create(name='Confort S.A.')
    employee = User.objects.create_user('emp@confort.demo', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=org)
    building = create_building(org, employee, name='Edificio Constante', address='Av. 100')
    unit = Unit.objects.create(
        building=building, number='101', floor=1, coefficient=Decimal('1.000000')
    )
    resident_user = User.objects.create_user(
        'constante@residentes.demo', password='password-12345', first_name='Ana', last_name='Constante'
    )
    person = Person.objects.create(
        organization=org,
        first_name='Ana',
        last_name='Constante',
        email='constante@residentes.demo',
        user=resident_user,
    )
    occ = Occupancy.objects.create(
        unit=unit, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1)
    )
    concept = building.concepts.filter(kind=ExpenseConcept.Kind.ORDINARY).first()

    def add_month_charge_and_payment(month_num):
        month_date = date(2026, month_num, 1)
        settlement = Settlement.objects.create(
            building=building,
            month=month_date,
            status=Settlement.Status.DRAFT,
        )
        settlement.items.create(concept=concept, amount=Decimal('1000.00'))
        settlement.status = Settlement.Status.ISSUED
        settlement.issued_by = employee
        settlement.issued_at = datetime(2026, month_num, 1, tzinfo=dt_timezone.utc)
        settlement.save(update_fields=['status', 'issued_by', 'issued_at', 'updated_at'])
        LedgerEntry.objects.create(
            occupancy=occ,
            date=month_date,
            kind=LedgerEntry.Kind.CHARGE,
            amount=Decimal('1000.00'),
            settlement=settlement,
            concept=concept,
            created_by=employee,
            base_amount=Decimal('1000.00'),
            coefficient=Decimal('1.000000'),
            days=30,
            days_in_month=30,
        )
        LedgerEntry.objects.create(
            occupancy=occ,
            date=date(2026, month_num, 5),
            kind=LedgerEntry.Kind.PAYMENT,
            amount=Decimal('-1000.00'),
            description=f'Pago mes {month_num}',
            created_by=employee,
        )

    for m in range(1, 4):
        add_month_charge_and_payment(m)
    assert LedgerEntry.objects.filter(occupancy=occ).count() == 6

    client = api_client_for(resident_user)
    with CaptureQueriesContext(connection) as account_queries_6:
        acc_6 = client.get(f'/api/v1/portal/occupancies/{occ.pk}/account?month=2026-03')
    with CaptureQueriesContext(connection) as movements_queries_6:
        mov_6 = client.get(f'/api/v1/portal/occupancies/{occ.pk}/movements')
    assert acc_6.status_code == mov_6.status_code == 200
    assert len(mov_6.json()['movements']) == 6

    for m in range(4, 7):
        add_month_charge_and_payment(m)
    assert LedgerEntry.objects.filter(occupancy=occ).count() == 12

    with CaptureQueriesContext(connection) as account_queries_12:
        acc_12 = client.get(f'/api/v1/portal/occupancies/{occ.pk}/account?month=2026-06')
    with CaptureQueriesContext(connection) as movements_queries_12:
        mov_12 = client.get(f'/api/v1/portal/occupancies/{occ.pk}/movements')
    assert acc_12.status_code == mov_12.status_code == 200
    assert len(mov_12.json()['movements']) == 12

    assert len(account_queries_12) == len(account_queries_6)
    assert len(movements_queries_12) == len(movements_queries_6)

    submit_receipt(
        person,
        resident_user,
        file_key='rec-constante.pdf',
        file_sha256='e' * 64,
        content_type='application/pdf',
        size_bytes=512,
        declared_amount=Decimal('1000.00'),
        transfer_date=date(2026, 6, 10),
        allocations={occ: Decimal('1000.00')},
    )

    for url in (
        f'/api/v1/portal/occupancies/{occ.pk}/account?month=2026-06',
        f'/api/v1/portal/occupancies/{occ.pk}/months?month=2026-06',
        f'/api/v1/portal/occupancies/{occ.pk}/settlements/2026-06',
        f'/api/v1/portal/occupancies/{occ.pk}/movements',
        f'/api/v1/portal/occupancies/{occ.pk}/receipts',
    ):
        resp = client.get(url)
        assert resp.status_code == 200, url
        for path, value in walk_json(resp.json()):
            key = path[-1].lower() if path else ''
            assert not isinstance(value, float), f'float at {".".join(path)} in {url}'
            if key in MONEY_KEYS or key.endswith(
                ('amount', 'balance', 'charge', 'coefficient', 'total', 'debit', 'credit')
            ):
                assert not isinstance(value, int), f'int at {".".join(path)} in {url}'
                assert isinstance(value, str), f'non-string at {".".join(path)} in {url}'


def test_open_claim_and_reply_record_audit_log_with_resident_actor(demo):
    minas = demo.buildings.get(name='Edificio Minas')
    juan_user = User.objects.get(email='juan.perez@correo.com.uy')
    juan_occ = minas.units.get(number='101').occupancies.get(role=Occupancy.Role.OWNER)
    client = api_client_for(juan_user)

    before_events = AuditLog.objects.count()
    before_changes = RowChange.objects.filter(actor=juan_user).count()

    open_resp = client.post(
        f'/api/v1/portal/occupancies/{juan_occ.pk}/claims',
        {
            'kind': 'report',
            'title': 'Portero eléctrico sin sonido',
            'body': 'No se escucha desde el apartamento 101.',
        },
        format='json',
    )
    assert open_resp.status_code == 201
    claim_data = open_resp.json()
    claim_id = claim_data['id']
    assert AuditLog.objects.count() == before_events + 1
    open_event = AuditLog.objects.order_by('-created_at', '-pk').first()
    assert open_event.actor == juan_user
    assert open_event.organization == demo
    assert str(open_event.target_id) == claim_id

    reply_resp = client.post(
        f'/api/v1/portal/claims/{claim_id}/replies',
        {'text': 'Tampoco funciona el botón de apertura.'},
        format='json',
    )
    assert reply_resp.status_code == 201
    reply_data = reply_resp.json()
    assert AuditLog.objects.count() == before_events + 2
    reply_event = AuditLog.objects.order_by('-created_at', '-pk').first()
    assert reply_event.actor == juan_user
    assert reply_event.organization == demo
    assert str(reply_event.target_id) == reply_data['id']
    assert RowChange.objects.filter(actor=juan_user).count() > before_changes


def test_portal_claim_rules_resolved_validation_and_csrf(demo):
    minas = demo.buildings.get(name='Edificio Minas')
    juan_user = User.objects.get(email='juan.perez@correo.com.uy')
    juan_occ = minas.units.get(number='101').occupancies.get(role=Occupancy.Role.OWNER)
    client = api_client_for(juan_user)

    bad_kind = client.post(
        f'/api/v1/portal/occupancies/{juan_occ.pk}/claims',
        {'kind': 'invalido', 'title': 'Título válido'},
        format='json',
    )
    assert bad_kind.status_code == 400
    assert 'tipo de reclamo' in bad_kind.json()['detail']

    short_title = client.post(
        f'/api/v1/portal/occupancies/{juan_occ.pk}/claims',
        {'kind': 'reporte', 'title': 'abc'},
        format='json',
    )
    assert short_title.status_code == 400
    assert 'El título debe tener entre 4 y 120 caracteres.' in short_title.json()['detail']

    claim = Claim.objects.get(unit=juan_occ.unit, author=juan_occ.person)
    Claim.objects.filter(pk=claim.pk).update(status=Claim.Status.RESOLVED)

    resolved_reply = client.post(
        f'/api/v1/portal/claims/{claim.pk}/replies',
        {'text': 'Sigue sin funcionar.'},
        format='json',
    )
    assert resolved_reply.status_code == 400
    assert 'está resuelto' in resolved_reply.json()['detail']

    no_csrf = APIClient(enforce_csrf_checks=True)
    no_csrf.force_login(juan_user)
    assert (
        no_csrf.post(
            f'/api/v1/portal/occupancies/{juan_occ.pk}/claims',
            {'kind': 'report', 'title': 'Sin CSRF'},
            format='json',
        ).status_code
        == 403
    )
    assert (
        no_csrf.post(
            f'/api/v1/portal/claims/{claim.pk}/replies',
            {'text': 'Sin CSRF'},
            format='json',
        ).status_code
        == 403
    )

