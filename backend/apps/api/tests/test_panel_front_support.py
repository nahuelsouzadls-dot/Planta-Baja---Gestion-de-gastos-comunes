"""Datos que el panel conectado (C4b) necesita de la API y que no estaban en C3a."""
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.accounts.models import User
from apps.api.testing import api_client_for, assert_cross_org_404
from apps.communications.models import Claim
from apps.people.models import Occupancy
from tests.factories import OrgMembershipFactory


pytestmark = pytest.mark.django_db


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')
    return User.objects.get(email='maria@admin.demo')


def organization_of(user):
    return user.org_memberships.get().organization


def test_settlements_list_concepts_with_ids(demo):
    building = organization_of(demo).buildings.get(name='Edificio Minas')
    data = api_client_for(demo).get(f'/api/v1/buildings/{building.pk}/settlements').json()

    names = [concept['name'] for concept in data['concepts']]
    assert names == [
        'O.S.E. (agua)', 'U.T.E. (luz)', 'Limpieza', 'Honorarios de administración',
        'Fondo de reserva', 'Cuota extraordinaria',
    ]
    extraordinary = data['concepts'][-1]
    assert extraordinary['kind'] == 'owner_only'
    assert extraordinary['is_reserve_fund'] is False
    concept_ids = {concept['id'] for concept in data['concepts']}
    for settlement in data['settlements']:
        assert {item['concept_id'] for item in settlement['items']} <= concept_ids


def test_tasks_carry_their_building_id(demo):
    organization = organization_of(demo)
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    created = client.post(
        f'/api/v1/organizations/{organization.pk}/tasks',
        {'building_id': str(building.pk), 'text': 'Llamar al plomero'},
        format='json',
    )

    assert created.status_code == 201
    assert created.json()['building_id'] == str(building.pk)
    listed = client.get(f'/api/v1/organizations/{organization.pk}/tasks').json()['tasks']
    assert listed[0]['building_id'] == str(building.pk)


def test_portfolio_building_rows_add_up_to_the_totals(demo):
    organization = organization_of(demo)
    data = api_client_for(demo).get(
        f'/api/v1/organizations/{organization.pk}/portfolio?month=2026-10'
    ).json()
    rows = {row['name']: row for row in data['buildings']}

    assert sum(Decimal(row['debt']) for row in rows.values()) == Decimal(data['portfolio_totals']['debt'])
    assert sum(row['counts']['moroso'] for row in rows.values()) == data['portfolio_totals']['delinquent']
    assert rows['Edificio Minas']['neighborhood'] == 'Pocitos'
    assert rows['Edificio Minas']['due_day'] == 10
    # Minas: el 203 inquilino debe agosto y setiembre.
    assert rows['Edificio Minas']['severe'] is True
    assert rows['Edificio Centro']['severe'] is False


def test_overdue_account_is_moroso_even_without_current_settlement(demo):
    # Pocitos no tiene octubre emitido; el 203 propietario debe agosto y setiembre.
    building = organization_of(demo).buildings.get(name='Edificio Pocitos')
    accounts = api_client_for(demo).get(
        f'/api/v1/buildings/{building.pk}/accounts?month=2026-10'
    ).json()['accounts']
    row = next(a for a in accounts if a['unit'] == '203' and a['role'] == 'owner')

    assert row['status'] == 'moroso'
    assert row['overdue_months'] == ['2026-08', '2026-09']
    assert Decimal(row['overdue_amount']) == Decimal(row['balance'])
    paid_up = [a for a in accounts if not a['overdue_months']]
    assert paid_up and all(a['status'] == 'sin-cargar' for a in paid_up)


def test_collection_history_uses_fifo_coverage_per_month(demo):
    organization = organization_of(demo)
    client = api_client_for(demo)
    months = client.get(
        f'/api/v1/organizations/{organization.pk}/collection-history?month=2026-10'
    ).json()['months']
    totals = client.get(
        f'/api/v1/organizations/{organization.pk}/portfolio?month=2026-10'
    ).json()['portfolio_totals']

    assert [m['month'] for m in months] == ['2026-07', '2026-08', '2026-09', '2026-10']
    assert all(isinstance(m['charged'], str) and isinstance(m['collected'], str) for m in months)
    assert months[0]['collected'] == months[0]['charged']
    assert months[-1]['charged'] == totals['expected']
    assert months[-1]['collected'] == totals['collected']


def test_collection_history_is_scoped_to_the_organization(demo):
    outsider = OrgMembershipFactory().user
    assert_cross_org_404(
        api_client_for(outsider),
        f'/api/v1/organizations/{organization_of(demo).pk}/collection-history',
    )


def test_occupancy_detail_shows_role_and_building_totals(demo):
    occupancy = Occupancy.objects.get(
        unit__building__name='Edificio Minas', unit__number='101', role='owner'
    )
    data = api_client_for(demo).get(
        f'/api/v1/occupancies/{occupancy.pk}?month=2026-10'
    ).json()

    assert data['role'] == 'owner'
    lines = {line['concept']: line for line in data['lines']}
    assert lines['O.S.E. (agua)']['total'] == '4200.00'
    assert lines['O.S.E. (agua)']['amount'] == '361.20'


def test_claim_messages_show_names_not_emails(demo):
    claim = Claim.objects.get(title='Humedad en el pasillo del 2.º piso')
    client = api_client_for(demo)
    messages = client.get(f'/api/v1/claims/{claim.pk}').json()['messages']

    assert messages[0]['author'] == 'Pedro Martínez'
    assert all('@' not in message['author'] for message in messages)
    reply = client.post(
        f'/api/v1/claims/{claim.pk}/replies', {'text': 'Vamos el lunes.'}, format='json'
    ).json()
    assert '@' not in reply['author']


def test_mid_month_tenant_change_shows_both_accounts(demo):
    organization = organization_of(demo)
    building = organization.buildings.get(name='Edificio Minas')
    unit = building.units.get(number='304')
    client = api_client_for(demo)
    person = client.post(
        f'/api/v1/organizations/{organization.pk}/people',
        {'first_name': 'Lucía', 'last_name': 'Benítez'},
        format='json',
    ).json()
    changed = client.post(
        f'/api/v1/units/{unit.pk}/replace-tenant',
        {'person_id': person['id'], 'change_date': '2026-10-24'},
        format='json',
    )
    assert changed.status_code == 201

    accounts = client.get(f'/api/v1/buildings/{building.pk}/accounts?month=2026-10').json()['accounts']
    tenants = sorted(a['person']['name'] for a in accounts if a['unit'] == '304' and a['role'] == 'tenant')
    assert tenants == ['Lucía Benítez', 'Ramón Herrera']
    totals = client.get(
        f'/api/v1/organizations/{organization.pk}/portfolio?month=2026-10'
    ).json()['portfolio_totals']
    assert totals['accounts'] == 50
