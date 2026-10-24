from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.accounts.models import OrgMembership, Organization, User
from apps.api.testing import api_client_for, assert_cross_org_404
from apps.buildings.models import Building, Unit
from apps.ledger.models import LedgerEntry
from apps.people.models import Occupancy, Person


def make_org(name):
    return Organization.objects.create(name=name)


def make_building(organization, name='Edificio'):
    building = Building.objects.create(
        organization=organization, name=name, address='Calle 123'
    )
    unit = Unit.objects.create(
        building=building, number='101', floor=1, coefficient=Decimal('1.000000')
    )
    return building, unit


@pytest.mark.django_db
def test_employee_scope_and_foreign_objects_are_404():
    org_a = make_org('A')
    org_b = make_org('B')
    building_a, unit_a = make_building(org_a, 'A')
    building_b, unit_b = make_building(org_b, 'B')
    employee = User.objects.create_user('employee@example.com', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=org_a)

    client = api_client_for(employee)
    organizations = client.get('/api/v1/organizations')
    assert organizations.status_code == 200
    assert [item['id'] for item in organizations.json()] == [str(org_a.pk)]
    assert_cross_org_404(
        client, f'/api/v1/organizations/{org_b.pk}/buildings'
    )
    assert_cross_org_404(client, f'/api/v1/buildings/{building_b.pk}')
    assert client.get(f'/api/v1/buildings/{building_a.pk}').json()['units'][0][
        'coefficient'
    ] == '1.000000'
    assert unit_a.pk != unit_b.pk


@pytest.mark.django_db
def test_employee_with_two_organizations_sees_both():
    org_a = make_org('A')
    org_b = make_org('B')
    make_building(org_a)
    make_building(org_b)
    employee = User.objects.create_user('multi@example.com', password='password-12345')
    OrgMembership.objects.create(user=employee, organization=org_a)
    OrgMembership.objects.create(user=employee, organization=org_b)

    response = api_client_for(employee).get('/api/v1/organizations')
    assert response.status_code == 200
    assert {item['id'] for item in response.json()} == {
        str(org_a.pk), str(org_b.pk)
    }


@pytest.mark.django_db
def test_resident_scope_keeps_debtor_ex_tenant_and_drops_settled_one():
    organization = make_org('A')
    building, unit = make_building(organization)
    debtor = User.objects.create_user('debtor@example.com', password='password-12345')
    settled = User.objects.create_user('settled@example.com', password='password-12345')
    debtor_person = Person.objects.create(
        organization=organization, first_name='Ex', last_name='Inquilino', user=debtor
    )
    settled_person = Person.objects.create(
        organization=organization, first_name='Ex', last_name='Al Día', user=settled
    )
    debtor_occupancy = Occupancy.objects.create(
        unit=unit, person=debtor_person, role='tenant',
        start_date=date.today() - timedelta(days=90), end_date=date.today() - timedelta(days=1)
    )
    settled_occupancy = Occupancy.objects.create(
        unit=unit, person=settled_person, role='tenant',
        start_date=date.today() - timedelta(days=180), end_date=date.today() - timedelta(days=91)
    )
    LedgerEntry.objects.create(
        occupancy=debtor_occupancy, date=date.today() - timedelta(days=2),
        kind='opening', amount=Decimal('100.00'), created_by=debtor
    )
    response = api_client_for(debtor).get('/api/v1/portal/occupancies')
    assert response.status_code == 200
    assert response.json()[0]['closed'] is True
    assert api_client_for(settled).get('/api/v1/portal/occupancies').status_code == 403


@pytest.mark.django_db
def test_employee_and_resident_scopes_are_independent():
    employee_org = make_org('Empleado')
    resident_org = make_org('Residente')
    _, resident_unit = make_building(resident_org)
    user = User.objects.create_user('both@example.com', password='password-12345')
    OrgMembership.objects.create(user=user, organization=employee_org)
    person = Person.objects.create(
        organization=resident_org, first_name='Persona', last_name='Mixta', user=user
    )
    Occupancy.objects.create(
        unit=resident_unit, person=person, role='tenant',
        start_date=date.today(), end_date=None
    )

    client = api_client_for(user)
    assert [item['id'] for item in client.get('/api/v1/organizations').json()] == [
        str(employee_org.pk)
    ]
    assert len(client.get('/api/v1/portal/occupancies').json()) == 1


@pytest.mark.django_db
def test_sec3_4_me_and_resident_buildings_match_resident_occupancies_scope():
    from apps.api.scoping import resident_buildings, resident_occupancies

    organization = make_org('Org N17 Sec3')
    building, unit = make_building(organization, 'Edificio Sur')

    settled = User.objects.create_user('settled-sec3@example.com', password='password-12345')
    settled_person = Person.objects.create(
        organization=organization, first_name='Ex', last_name='Saldado', user=settled
    )
    Occupancy.objects.create(
        unit=unit,
        person=settled_person,
        role=Occupancy.Role.TENANT,
        start_date=date.today() - timedelta(days=120),
        end_date=date.today() - timedelta(days=30),
    )

    settled_client = api_client_for(settled)
    assert settled_client.get('/api/v1/portal/occupancies').status_code == 403
    assert list(resident_occupancies(settled)) == []
    assert list(resident_buildings(settled)) == []
    me_settled = settled_client.get('/api/v1/auth/me')
    assert me_settled.status_code == 200
    assert me_settled.json()['persons'][0]['occupancies'] == []

    debtor = User.objects.create_user('debtor-sec3@example.com', password='password-12345')
    debtor_person = Person.objects.create(
        organization=organization, first_name='Ex', last_name='Deudor', user=debtor
    )
    debtor_occ = Occupancy.objects.create(
        unit=unit,
        person=debtor_person,
        role=Occupancy.Role.TENANT,
        start_date=date.today() - timedelta(days=240),
        end_date=date.today() - timedelta(days=130),
    )
    LedgerEntry.objects.create(
        occupancy=debtor_occ,
        date=date.today() - timedelta(days=140),
        kind='opening',
        amount=Decimal('500.00'),
        created_by=debtor,
    )

    debtor_client = api_client_for(debtor)
    assert [o.pk for o in resident_occupancies(debtor)] == [debtor_occ.pk]
    assert list(resident_buildings(debtor)) == [building]
    me_debtor = debtor_client.get('/api/v1/auth/me')
    assert me_debtor.status_code == 200
    assert [o['id'] for o in me_debtor.json()['persons'][0]['occupancies']] == [str(debtor_occ.pk)]


def test_sec3_7_assert_cross_org_404_rejects_uuid_leaked_in_nested_route():
    from types import SimpleNamespace

    foreign_uuid = '12345678-1234-5678-1234-567812345678'

    class LeakyClient:
        def get(self, url, **kwargs):
            return SimpleNamespace(
                status_code=404,
                content=f'{{"detail": "Organización {foreign_uuid} no encontrada"}}'.encode('utf-8'),
            )

    with pytest.raises(AssertionError):
        assert_cross_org_404(
            LeakyClient(),
            f'/api/v1/organizations/{foreign_uuid}/buildings',
        )

