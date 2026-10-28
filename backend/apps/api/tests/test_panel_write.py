from datetime import date
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import OrgMembership, Organization, User
from apps.api.testing import api_client_for
from apps.audit.models import AuditLog, RowChange
from apps.buildings.models import Building, ExpenseConcept, Unit
from apps.buildings.services import create_building
from apps.communications.models import Claim, ClaimMessage, Notice, Task
from apps.ledger.models import LedgerEntry, Receipt, ReceiptAllocation
from apps.people.models import Occupancy, Person
from apps.settlements.models import Settlement


pytestmark = pytest.mark.django_db


WRITE_ROUTE_NAMES = (
    'create_building',
    'add_unit',
    'add_concept',
    'update_concept',
    'create_person',
    'update_person',
    'move_in',
    'move_out',
    'replace_tenant',
    'sell_unit',
    'correct_occupancy',
    'save_draft',
    'delete_draft',
    'issue_settlement',
    'approve_receipt',
    'reject_receipt',
    'manual_payment',
    'adjustment',
    'opening',
    'publish_notice',
    'reply_claim',
    'set_claim_status',
    'create_task',
    'toggle_task',
)


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')
    return User.objects.get(email='maria@admin.demo')


@pytest.fixture
def write_env():
    organization = Organization.objects.create(name='Administración Demo')
    employee = User.objects.create_user('maria@admin.demo', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=organization)

    resident_user = User.objects.create_user(
        'juan.perez@correo.com.uy', password='password-12345'
    )
    building = create_building(
        organization, employee, name='Edificio Minas', address='Minas 1450'
    )
    unit_101 = Unit.objects.create(
        building=building, number='101', floor=1, coefficient=Decimal('0.500000')
    )
    unit_102 = Unit.objects.create(
        building=building, number='102', floor=1, coefficient=Decimal('0.500000')
    )
    owner_person_101 = Person.objects.create(
        organization=organization,
        first_name='Juan',
        last_name='Pérez',
        email='juan.perez@correo.com.uy',
        user=resident_user,
    )
    owner_person_102 = Person.objects.create(
        organization=organization,
        first_name='Ana',
        last_name='Gómez',
        email='ana.gomez@example.com',
    )
    tenant_person_102 = Person.objects.create(
        organization=organization,
        first_name='María',
        last_name='García',
        email='maria.garcia@example.com',
    )
    owner_101 = Occupancy.objects.create(
        unit=unit_101,
        person=owner_person_101,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 1, 1),
    )
    Occupancy.objects.create(
        unit=unit_102,
        person=owner_person_102,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 1, 1),
    )
    tenant_102 = Occupancy.objects.create(
        unit=unit_102,
        person=tenant_person_102,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 1, 1),
    )

    aux_building = Building.objects.create(
        organization=organization, name='Edificio Auxiliar', address='Aux 100'
    )
    aux_unit = Unit.objects.create(
        building=aux_building, number='1', floor=1, coefficient=Decimal('1.000000')
    )
    extra_person = Person.objects.create(
        organization=organization,
        first_name='Editable',
        last_name='SinMovimientos',
        email='editable@example.com',
    )
    clean_occupancy = Occupancy.objects.create(
        unit=aux_unit,
        person=extra_person,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 11, 1),
    )
    candidate_person = Person.objects.create(
        organization=organization,
        first_name='Candidato',
        last_name='Ingreso',
        email='candidato@example.com',
    )

    draft = Settlement.objects.create(
        building=building,
        month=date(2026, 11, 1),
        status=Settlement.Status.DRAFT,
    )
    concept = building.concepts.filter(kind=ExpenseConcept.Kind.ORDINARY).first()
    draft.items.create(concept=concept, amount=Decimal('10000.00'))

    receipt_1 = Receipt.objects.create(
        person=tenant_person_102,
        uploaded_by=employee,
        file_key='r1.pdf',
        file_sha256='a' * 64,
        content_type='application/pdf',
        size_bytes=1024,
        declared_amount=Decimal('2500.00'),
        transfer_date=date(2026, 10, 5),
    )
    ReceiptAllocation.objects.create(
        receipt=receipt_1, occupancy=tenant_102, amount=Decimal('2500.00')
    )
    receipt_2 = Receipt.objects.create(
        person=tenant_person_102,
        uploaded_by=employee,
        file_key='r2.pdf',
        file_sha256='b' * 64,
        content_type='application/pdf',
        size_bytes=1024,
        declared_amount=Decimal('1800.00'),
        transfer_date=date(2026, 10, 6),
    )
    ReceiptAllocation.objects.create(
        receipt=receipt_2, occupancy=tenant_102, amount=Decimal('1800.00')
    )

    entry = LedgerEntry.objects.create(
        occupancy=owner_101,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.OPENING,
        amount=Decimal('1000.00'),
        created_by=employee,
    )
    claim = Claim.objects.create(
        building=building,
        unit=unit_101,
        author=owner_person_101,
        kind=Claim.Kind.REPORT,
        title='Humedad en techo',
        status=Claim.Status.PENDING,
    )
    task = Task.objects.create(
        organization=organization,
        building=building,
        text='Tarea de prueba',
        created_by=employee,
    )

    specs = {
        'create_building': (
            'post',
            f'/api/v1/organizations/{organization.pk}/buildings',
            {
                'name': 'Edificio Nuevo',
                'address': 'Bulevar Artigas 1234',
                'neighborhood': 'Tres Cruces',
                'due_day': 10,
                'reserve_opening': '5000.00',
            },
        ),
        'add_unit': (
            'post',
            f'/api/v1/buildings/{building.pk}/units',
            {
                'number': '401',
                'floor': 4,
                'coefficient': '0.050000',
                'receives_paper': True,
            },
        ),
        'create_person': (
            'post',
            f'/api/v1/organizations/{organization.pk}/people',
            {
                'first_name': 'Nueva',
                'last_name': 'Persona',
                'email': 'nueva.persona@example.com',
                'phone': '099111222',
                'document': '4.123.456-7',
            },
        ),
        'update_person': (
            'patch',
            f'/api/v1/people/{extra_person.pk}',
            {'phone': '099000999'},
        ),
        'move_in': (
            'post',
            f'/api/v1/units/{unit_101.pk}/move-in',
            {
                'person_id': str(candidate_person.pk),
                'role': 'tenant',
                'start_date': '2026-11-01',
            },
        ),
        'move_out': (
            'post',
            f'/api/v1/occupancies/{tenant_102.pk}/move-out',
            {'end_date': '2026-11-30'},
        ),
        'replace_tenant': (
            'post',
            f'/api/v1/units/{unit_102.pk}/replace-tenant',
            {
                'person_id': str(candidate_person.pk),
                'change_date': '2026-11-15',
            },
        ),
        'sell_unit': (
            'post',
            f'/api/v1/units/{unit_102.pk}/sell',
            {
                'buyer_id': str(candidate_person.pk),
                'sale_date': '2026-11-01',
            },
        ),
        'correct_occupancy': (
            'patch',
            f'/api/v1/occupancies/{clean_occupancy.pk}',
            {'start_date': '2026-11-05'},
        ),
        'add_concept': (
            'post',
            f'/api/v1/buildings/{building.pk}/concepts',
            {'name': 'Ascensor', 'kind': 'ordinary'},
        ),
        'update_concept': (
            'patch',
            f'/api/v1/concepts/{concept.pk}',
            {'name': 'Agua (O.S.E.)'},
        ),
        'save_draft': (
            'put',
            f'/api/v1/buildings/{building.pk}/settlements/2026-12',
            {'items': {str(concept.pk): '15000.00'}},
        ),
        'delete_draft': (
            'delete',
            f'/api/v1/buildings/{building.pk}/settlements/2026-11',
            {},
        ),
        'issue_settlement': (
            'post',
            f'/api/v1/buildings/{building.pk}/settlements/2026-11/issue',
            {},
        ),
        'approve_receipt': (
            'post',
            f'/api/v1/receipts/{receipt_1.pk}/approve',
            {},
        ),
        'reject_receipt': (
            'post',
            f'/api/v1/receipts/{receipt_2.pk}/reject',
            {'reason': 'Monto no coincide con transferencia'},
        ),
        'manual_payment': (
            'post',
            f'/api/v1/occupancies/{owner_101.pk}/payments',
            {
                'amount': '1000.00',
                'date': '2026-10-20',
                'source': 'Extracto bancario',
            },
        ),
        'adjustment': (
            'post',
            f'/api/v1/occupancies/{owner_101.pk}/adjustments',
            {
                'entry_id': str(entry.pk),
                'amount': '-150.00',
                'description': 'Ajuste por redondeo',
            },
        ),
        'opening': (
            'post',
            f'/api/v1/occupancies/{clean_occupancy.pk}/opening',
            {
                'amount': '2500.00',
                'date': '2026-11-01',
            },
        ),
        'publish_notice': (
            'post',
            f'/api/v1/buildings/{building.pk}/notices',
            {
                'title': 'Fumigación general',
                'body': 'El sábado de mañana se realizará fumigación en áreas comunes.',
            },
        ),
        'reply_claim': (
            'post',
            f'/api/v1/claims/{claim.pk}/replies',
            {'text': 'Coordinamos visita técnica para mañana.'},
        ),
        'set_claim_status': (
            'patch',
            f'/api/v1/claims/{claim.pk}',
            {'status': Claim.Status.RESOLVED},
        ),
        'create_task': (
            'post',
            f'/api/v1/organizations/{organization.pk}/tasks',
            {
                'building_id': str(building.pk),
                'text': 'Revisar extintores del subsuelo',
                'due_date': '2026-11-10',
            },
        ),
        'toggle_task': (
            'post',
            f'/api/v1/tasks/{task.pk}/toggle',
            {},
        ),
    }
    return employee, resident_user, specs


def test_happy_paths_buildings_units_and_people(demo):
    organization = demo.org_memberships.get().organization
    client = api_client_for(demo)

    b_resp = client.post(
        f'/api/v1/organizations/{organization.pk}/buildings',
        {
            'name': 'Edificio Rivera',
            'address': 'Av. Rivera 2100',
            'neighborhood': 'Cordón',
            'due_day': 12,
            'reserve_opening': '15000.00',
        },
        format='json',
    )
    assert b_resp.status_code == 201
    building_data = b_resp.json()
    created_building = Building.objects.get(pk=building_data['id'])
    assert created_building.organization == organization
    assert created_building.name == 'Edificio Rivera'
    assert building_data['reserve_opening'] == '15000.00'
    assert created_building.concepts.count() == 6

    u_resp = client.post(
        f'/api/v1/buildings/{created_building.pk}/units',
        {
            'number': '101',
            'floor': 1,
            'coefficient': '1.000000',
            'receives_paper': True,
        },
        format='json',
    )
    assert u_resp.status_code == 201
    unit_data = u_resp.json()
    created_unit = Unit.objects.get(pk=unit_data['id'])
    assert created_unit.building == created_building
    assert unit_data['coefficient'] == '1.000000'
    assert created_unit.receives_paper is True

    p_resp = client.post(
        f'/api/v1/organizations/{organization.pk}/people',
        {
            'first_name': 'Laura',
            'last_name': 'Méndez',
            'email': 'laura@example.com',
            'phone': '099111222',
            'document': '4.111.222-3',
        },
        format='json',
    )
    assert p_resp.status_code == 201
    person_data = p_resp.json()
    created_person = Person.objects.get(pk=person_data['id'])
    assert created_person.organization == organization
    assert created_person.email == 'laura@example.com'

    patch_resp = client.patch(
        f'/api/v1/people/{created_person.pk}',
        {'phone': '099888777', 'first_name': 'Laura María'},
        format='json',
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()['phone'] == '099888777'
    created_person.refresh_from_db()
    assert created_person.phone == '099888777'
    assert created_person.first_name == 'Laura María'


def test_happy_paths_occupancies_lifecycle(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    unit_101 = building.units.get(number='101')
    unit_102 = building.units.get(number='102')
    unit_103 = building.units.get(number='103')
    client = api_client_for(demo)

    person_a = Person.objects.create(
        organization=organization, first_name='Diego', last_name='Silva'
    )
    person_b = Person.objects.create(
        organization=organization, first_name='Elena', last_name='Rojas'
    )
    buyer = Person.objects.create(
        organization=organization, first_name='Comprador', last_name='Firme'
    )

    move_in_resp = client.post(
        f'/api/v1/units/{unit_101.pk}/move-in',
        {'person_id': str(person_a.pk), 'role': 'tenant', 'start_date': '2026-11-01'},
        format='json',
    )
    assert move_in_resp.status_code == 201
    occ_id = move_in_resp.json()['id']
    occ = Occupancy.objects.get(pk=occ_id)
    assert occ.unit == unit_101
    assert occ.person == person_a
    assert occ.role == Occupancy.Role.TENANT

    correct_resp = client.patch(
        f'/api/v1/occupancies/{occ.pk}',
        {'start_date': '2026-11-03'},
        format='json',
    )
    assert correct_resp.status_code == 200
    assert correct_resp.json()['start_date'] == '2026-11-03'
    occ.refresh_from_db()
    assert occ.start_date == date(2026, 11, 3)

    move_out_resp = client.post(
        f'/api/v1/occupancies/{occ.pk}/move-out',
        {'end_date': '2026-11-30'},
        format='json',
    )
    assert move_out_resp.status_code == 200
    assert move_out_resp.json()['end_date'] == '2026-11-30'
    occ.refresh_from_db()
    assert occ.end_date == date(2026, 11, 30)

    old_tenant_102 = unit_102.occupancies.get(role=Occupancy.Role.TENANT, end_date__isnull=True)
    replace_resp = client.post(
        f'/api/v1/units/{unit_102.pk}/replace-tenant',
        {'person_id': str(person_b.pk), 'change_date': '2026-11-15'},
        format='json',
    )
    assert replace_resp.status_code == 201
    old_tenant_102.refresh_from_db()
    assert old_tenant_102.end_date == date(2026, 11, 14)
    new_tenant_102 = Occupancy.objects.get(pk=replace_resp.json()['id'])
    assert new_tenant_102.person == person_b
    assert new_tenant_102.start_date == date(2026, 11, 15)

    old_owner_103 = unit_103.occupancies.get(role=Occupancy.Role.OWNER, end_date__isnull=True)
    sell_resp = client.post(
        f'/api/v1/units/{unit_103.pk}/sell',
        {'buyer_id': str(buyer.pk), 'sale_date': '2026-11-01'},
        format='json',
    )
    assert sell_resp.status_code == 201
    old_owner_103.refresh_from_db()
    assert old_owner_103.end_date == date(2026, 10, 31)
    new_owner_103 = Occupancy.objects.get(pk=sell_resp.json()['id'])
    assert new_owner_103.person == buyer
    assert new_owner_103.role == Occupancy.Role.OWNER


def test_happy_paths_settlements_draft_delete_and_issue(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    ordinary = building.concepts.filter(kind=ExpenseConcept.Kind.ORDINARY).first()
    extra = building.concepts.filter(
        kind=ExpenseConcept.Kind.OWNER_ONLY, is_reserve_fund=False
    ).first()

    put_resp = client.put(
        f'/api/v1/buildings/{building.pk}/settlements/2026-11',
        {
            'items': {
                str(ordinary.pk): '20000.00',
                str(extra.pk): '4000.00',
            },
            'details': {
                str(extra.pk): 'Arreglo de bomba de agua',
            },
        },
        format='json',
    )
    assert put_resp.status_code == 200
    assert put_resp.json()['total'] == '24000.00'
    assert Settlement.objects.filter(building=building, month=date(2026, 11, 1)).exists()

    del_resp = client.delete(f'/api/v1/buildings/{building.pk}/settlements/2026-11')
    assert del_resp.status_code == 204
    assert not Settlement.objects.filter(building=building, month=date(2026, 11, 1)).exists()

    recreate_resp = client.put(
        f'/api/v1/buildings/{building.pk}/settlements/2026-11',
        {'items': {str(ordinary.pk): '12000.00'}},
        format='json',
    )
    assert recreate_resp.status_code == 200

    issue_resp = client.post(f'/api/v1/buildings/{building.pk}/settlements/2026-11/issue')
    assert issue_resp.status_code == 200
    issue_data = issue_resp.json()
    assert issue_data['total_distributed'] == '12000.00'
    assert issue_data['charges_count'] == 12
    settlement = Settlement.objects.get(building=building, month=date(2026, 11, 1))
    assert settlement.status == Settlement.Status.ISSUED
    assert LedgerEntry.objects.filter(
        settlement=settlement, kind=LedgerEntry.Kind.CHARGE
    ).count() == 12


def test_happy_paths_receipts_and_ledger_entries(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    pending = list(
        Receipt.objects.filter(
            person__organization=organization,
            status=Receipt.Status.PENDING,
        ).order_by('created_at', 'pk')
    )
    to_approve, to_reject = pending[0], pending[1]

    approve_resp = client.post(f'/api/v1/receipts/{to_approve.pk}/approve', {}, format='json')
    assert approve_resp.status_code == 200
    assert approve_resp.json()['status'] == Receipt.Status.APPROVED
    to_approve.refresh_from_db()
    assert to_approve.status == Receipt.Status.APPROVED
    assert LedgerEntry.objects.filter(
        receipt=to_approve, kind=LedgerEntry.Kind.PAYMENT
    ).exists()

    reject_resp = client.post(
        f'/api/v1/receipts/{to_reject.pk}/reject',
        {'reason': 'Comprobante duplicado'},
        format='json',
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()['status'] == Receipt.Status.REJECTED
    to_reject.refresh_from_db()
    assert to_reject.status == Receipt.Status.REJECTED
    assert not LedgerEntry.objects.filter(receipt=to_reject).exists()

    owner_101 = building.units.get(number='101').occupancies.get(role=Occupancy.Role.OWNER)
    pay_resp = client.post(
        f'/api/v1/occupancies/{owner_101.pk}/payments',
        {'amount': '1500.00', 'date': '2026-10-22', 'source': 'Transferencia BROU'},
        format='json',
    )
    assert pay_resp.status_code == 201
    assert pay_resp.json()['amount'] == '-1500.00'
    payment_entry = LedgerEntry.objects.get(pk=pay_resp.json()['id'])
    assert payment_entry.kind == LedgerEntry.Kind.PAYMENT
    assert payment_entry.amount == Decimal('-1500.00')

    adj_resp = client.post(
        f'/api/v1/occupancies/{owner_101.pk}/adjustments',
        {
            'entry_id': str(payment_entry.pk),
            'amount': '100.00',
            'description': 'Diferencia bancaria',
        },
        format='json',
    )
    assert adj_resp.status_code == 201
    assert adj_resp.json()['amount'] == '100.00'
    adj_entry = LedgerEntry.objects.get(pk=adj_resp.json()['id'])
    assert adj_entry.kind == LedgerEntry.Kind.ADJUSTMENT
    assert adj_entry.adjusts == payment_entry

    new_person = Person.objects.create(
        organization=organization, first_name='Apertura', last_name='Test'
    )
    new_occ = Occupancy.objects.create(
        unit=building.units.get(number='101'),
        person=new_person,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 12, 1),
    )
    open_resp = client.post(
        f'/api/v1/occupancies/{new_occ.pk}/opening',
        {'amount': '3450.25', 'date': '2026-12-01'},
        format='json',
    )
    assert open_resp.status_code == 201
    assert open_resp.json()['amount'] == '3450.25'
    assert LedgerEntry.objects.filter(
        pk=open_resp.json()['id'],
        occupancy=new_occ,
        kind=LedgerEntry.Kind.OPENING,
        amount=Decimal('3450.25'),
    ).exists()


def test_happy_paths_communications_and_tasks(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)

    notice_resp = client.post(
        f'/api/v1/buildings/{building.pk}/notices',
        {
            'title': 'Asamblea anual ordinaria',
            'body': 'Se convoca a los copropietarios para el viernes a las 19:30 hs.',
        },
        format='json',
    )
    assert notice_resp.status_code == 201
    assert Notice.objects.filter(
        pk=notice_resp.json()['id'], building=building, published_by=demo
    ).exists()

    claim = building.claims.filter(status=Claim.Status.PENDING).first()
    reply_resp = client.post(
        f'/api/v1/claims/{claim.pk}/replies',
        {'text': 'El técnico ya fue asignado.'},
        format='json',
    )
    assert reply_resp.status_code == 201
    assert ClaimMessage.objects.filter(
        pk=reply_resp.json()['id'], claim=claim, from_admin=True
    ).exists()
    claim.refresh_from_db()
    assert claim.status == Claim.Status.IN_PROGRESS

    status_resp = client.patch(
        f'/api/v1/claims/{claim.pk}',
        {'status': Claim.Status.RESOLVED},
        format='json',
    )
    assert status_resp.status_code == 200
    assert status_resp.json()['status'] == Claim.Status.RESOLVED
    claim.refresh_from_db()
    assert claim.status == Claim.Status.RESOLVED

    task_resp = client.post(
        f'/api/v1/organizations/{organization.pk}/tasks',
        {
            'building_id': str(building.pk),
            'text': 'Pedir presupuesto de pintura',
            'due_date': '2026-11-15',
        },
        format='json',
    )
    assert task_resp.status_code == 201
    task = Task.objects.get(pk=task_resp.json()['id'])
    assert task.done is False

    toggle_resp = client.post(f'/api/v1/tasks/{task.pk}/toggle', {}, format='json')
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()['done'] is True
    task.refresh_from_db()
    assert task.done is True


@pytest.mark.parametrize('route_name', WRITE_ROUTE_NAMES)
def test_write_routes_reject_foreign_employee_resident_and_missing_csrf(
    route_name, write_env
):
    employee, resident, specs = write_env
    method, url, payload = specs[route_name]

    foreign_org = Organization.objects.create(name='Administración Ajena')
    foreign_employee = User.objects.create_user(
        'ajeno@example.com', password='password-12345'
    )
    OrgMembership.objects.create(user=foreign_employee, organization=foreign_org)

    foreign_client = api_client_for(foreign_employee)
    resident_client = api_client_for(resident)
    no_csrf_client = APIClient(enforce_csrf_checks=True)
    no_csrf_client.force_login(employee)

    before_changes = RowChange.objects.count()
    before_events = AuditLog.objects.count()

    foreign_resp = getattr(foreign_client, method)(url, payload, format='json')
    assert foreign_resp.status_code == 404
    assert RowChange.objects.count() == before_changes
    assert AuditLog.objects.count() == before_events

    resident_resp = getattr(resident_client, method)(url, payload, format='json')
    assert resident_resp.status_code == 403
    assert RowChange.objects.count() == before_changes
    assert AuditLog.objects.count() == before_events

    csrf_resp = getattr(no_csrf_client, method)(url, payload, format='json')
    assert csrf_resp.status_code == 403
    assert RowChange.objects.count() == before_changes
    assert AuditLog.objects.count() == before_events


def test_domain_errors_return_400_with_service_message(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)

    # 1. Emitir dos veces
    reissue = client.post(f'/api/v1/buildings/{building.pk}/settlements/2026-10/issue')
    assert reissue.status_code == 400
    assert 'Solo se pueden emitir liquidaciones en borrador.' in reissue.json()['detail']

    # 2. Aprobar un comprobante ya aprobado
    receipt = Receipt.objects.filter(
        person__organization=organization, status=Receipt.Status.PENDING
    ).first()
    first_approve = client.post(f'/api/v1/receipts/{receipt.pk}/approve', {}, format='json')
    assert first_approve.status_code == 200
    second_approve = client.post(f'/api/v1/receipts/{receipt.pk}/approve', {}, format='json')
    assert second_approve.status_code == 400
    assert 'El comprobante ya fue revisado.' in second_approve.json()['detail']

    # 3. Vender con deuda (el mensaje dice el monto)
    unit_101 = building.units.get(number='101')
    buyer = Person.objects.create(
        organization=organization, first_name='Comprador', last_name='Deuda'
    )
    sell_debt = client.post(
        f'/api/v1/units/{unit_101.pk}/sell',
        {'buyer_id': str(buyer.pk), 'sale_date': '2026-11-01'},
        format='json',
    )
    assert sell_debt.status_code == 400
    assert '4153.80' in sell_debt.json()['detail']

    # 4. Monto con 3 decimales
    owner_101 = unit_101.occupancies.get(role=Occupancy.Role.OWNER)
    three_decimals = client.post(
        f'/api/v1/occupancies/{owner_101.pk}/payments',
        {'amount': '100.123', 'date': '2026-10-20', 'source': 'Banco'},
        format='json',
    )
    assert three_decimals.status_code == 400
    assert 'Los montos tienen como máximo 2 decimales' in three_decimals.json()['detail']

    # 5. Monto como número JSON
    number_amount = client.post(
        f'/api/v1/occupancies/{owner_101.pk}/payments',
        {'amount': 2615.00, 'date': '2026-10-20', 'source': 'Banco'},
        format='json',
    )
    assert number_amount.status_code == 400
    assert 'Los montos se envían como texto' in number_amount.json()['detail']

    # 6. Ajuste sobre un asiento de otra ocupación
    other_occupancy = building.units.get(number='102').occupancies.get(role=Occupancy.Role.OWNER)
    other_entry = LedgerEntry.objects.filter(occupancy=other_occupancy).first()
    before_adj_count = LedgerEntry.objects.filter(kind=LedgerEntry.Kind.ADJUSTMENT).count()
    wrong_occ_adj = client.post(
        f'/api/v1/occupancies/{owner_101.pk}/adjustments',
        {
            'entry_id': str(other_entry.pk),
            'amount': '-50.00',
            'description': 'Asiento ajeno',
        },
        format='json',
    )
    assert wrong_occ_adj.status_code in (400, 404)
    assert LedgerEntry.objects.filter(kind=LedgerEntry.Kind.ADJUSTMENT).count() == before_adj_count


@pytest.mark.parametrize('route_name', WRITE_ROUTE_NAMES)
def test_every_write_records_audit_log_with_employee_actor(route_name, write_env):
    employee, _, specs = write_env
    method, url, payload = specs[route_name]
    client = api_client_for(employee)

    before_events = AuditLog.objects.count()
    before_row_changes = RowChange.objects.filter(actor=employee).count()

    response = getattr(client, method)(url, payload, format='json')
    assert response.status_code in (200, 201, 204), response.content

    assert AuditLog.objects.count() == before_events + 1
    latest = AuditLog.objects.order_by('-created_at', '-pk').first()
    assert latest.actor == employee
    assert RowChange.objects.filter(actor=employee).count() > before_row_changes


def test_end_to_end_demo_approve_maria_garcia_updates_portfolio(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    unit_102 = building.units.get(number='102')
    client = api_client_for(demo)

    before = client.get(
        f'/api/v1/organizations/{organization.pk}/portfolio?month=2026-10'
    ).json()
    assert len(before['receipt_queue']) == 4

    receipt = Receipt.objects.get(
        person__first_name='María',
        person__last_name='García',
        allocations__occupancy__unit=unit_102,
        status=Receipt.Status.PENDING,
    )
    amount = receipt.declared_amount

    approve_resp = client.post(f'/api/v1/receipts/{receipt.pk}/approve', {}, format='json')
    assert approve_resp.status_code == 200

    after = client.get(
        f'/api/v1/organizations/{organization.pk}/portfolio?month=2026-10'
    ).json()
    assert len(after['receipt_queue']) == 3
    assert Decimal(after['portfolio_totals']['in_review']) == (
        Decimal(before['portfolio_totals']['in_review']) - amount
    )
    assert Decimal(after['portfolio_totals']['collected']) == (
        Decimal(before['portfolio_totals']['collected']) + amount
    )


def test_building_concepts_add_rename_deactivate(demo):
    """Conceptos propios del edificio: se agregan, se renombran y se desactivan; nunca se borran."""
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    url = f'/api/v1/buildings/{building.pk}/settlements'

    created = client.post(
        f'/api/v1/buildings/{building.pk}/concepts',
        {'name': 'Ascensor', 'kind': 'ordinary'},
        format='json',
    )
    assert created.status_code == 201
    concept = created.json()
    assert concept['is_active'] is True and concept['kind'] == 'ordinary'
    assert concept['id'] in {c['id'] for c in client.get(url).json()['concepts']}

    duplicate = client.post(
        f'/api/v1/buildings/{building.pk}/concepts',
        {'name': 'Ascensor', 'kind': 'ordinary'},
        format='json',
    )
    assert duplicate.status_code == 400

    renamed = client.patch(f'/api/v1/concepts/{concept["id"]}', {'name': 'Ascensor (service)'}, format='json')
    assert renamed.json()['name'] == 'Ascensor (service)'

    off = client.patch(f'/api/v1/concepts/{concept["id"]}', {'is_active': False}, format='json')
    assert off.json()['is_active'] is False
    listed = {c['id']: c for c in client.get(url).json()['concepts']}
    assert listed[concept['id']]['is_active'] is False
    draft = client.put(
        f'{url}/2026-12',
        {'items': {concept['id']: '1000.00'}},
        format='json',
    )
    assert draft.status_code == 400

    reserve = building.concepts.get(is_reserve_fund=True)
    keep = client.patch(f'/api/v1/concepts/{reserve.pk}', {'is_active': False}, format='json')
    assert keep.status_code == 400
    assert ExpenseConcept.objects.filter(pk=concept['id']).exists()
