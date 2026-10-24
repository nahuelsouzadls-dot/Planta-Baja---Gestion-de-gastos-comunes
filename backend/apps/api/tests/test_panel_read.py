from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from apps.accounts.models import User
from apps.buildings.models import Building, Unit
from apps.ledger.models import Receipt
from apps.people.models import Occupancy, Person
from apps.settlements.models import Settlement
from apps.api.testing import api_client_for


pytestmark = pytest.mark.django_db


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')
    return User.objects.get(email='maria@confort.demo')


def get_portfolio(client, organization):
    response = client.get(
        f'/api/v1/organizations/{organization.pk}/portfolio?month=2026-10'
    )
    assert response.status_code == 200
    return response.json()


def test_portfolio_returns_totals_buildings_and_receipt_queue(demo):
    organization = demo.org_memberships.get().organization
    data = get_portfolio(api_client_for(demo), organization)

    assert data['portfolio_totals'] == {
        'accounts': 49,
        'expected': '73830.00',
        'collected': '42024.90',
        'in_review': '11034.75',
        'debt': '18120.32',
        'delinquent': 4,
        'open_claims': 2,
    }
    assert len(data['buildings']) == 3
    assert len(data['receipt_queue']) == 4
    assert {
        'id', 'person', 'building', 'unit', 'role', 'file', 'date', 'amount'
    } <= set(data['receipt_queue'][0])
    assert all(isinstance(item['amount'], str) for item in data['receipt_queue'])


def test_accounts_contract_and_filters(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    response = client.get(f'/api/v1/buildings/{building.pk}/accounts?month=2026-10')

    assert response.status_code == 200
    assert len(response.json()['accounts']) == 18
    account = next(item for item in response.json()['accounts'] if item['unit'] == '101')
    assert account['balance'] == '4153.80'
    assert account['status'] == 'pendiente'
    filtered = client.get(
        f'/api/v1/buildings/{building.pk}/accounts?month=2026-10&status=revision'
    )
    assert all(item['status'] == 'revision' for item in filtered.json()['accounts'])


def test_summary_contract(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    response = api_client_for(demo).get(
        f'/api/v1/buildings/{building.pk}/summary?month=2026-10'
    )

    assert response.status_code == 200
    data = response.json()
    assert {'items', 'funds', 'delinquent'} <= set(data)
    assert data['funds']['coefficient_sum'] == '1.000000'


def test_settlements_contract(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    response = api_client_for(demo).get(f'/api/v1/buildings/{building.pk}/settlements')

    assert response.status_code == 200
    assert response.json()['settlements']
    assert {'month', 'status', 'items', 'total', 'issued_by', 'issued_at'} <= set(
        response.json()['settlements'][0]
    )


def test_notices_and_claims_contract(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)

    notices = client.get(f'/api/v1/buildings/{building.pk}/notices')
    claims = client.get(f'/api/v1/buildings/{building.pk}/claims')
    assert notices.status_code == claims.status_code == 200
    assert {'id', 'title', 'body', 'date', 'published_by'} <= set(notices.json()['notices'][0])
    assert {'id', 'title', 'kind', 'unit', 'author', 'status', 'date', 'message_count'} <= set(
        claims.json()['claims'][0]
    )


def test_occupancy_and_receipt_detail_contract(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    occupancy = building.units.get(number='101').occupancies.get(role='owner')
    receipt = Receipt.objects.filter(
        person__organization=organization, status=Receipt.Status.PENDING
    ).first()

    occupancy_response = client.get(f'/api/v1/occupancies/{occupancy.pk}?month=2026-10')
    receipt_response = client.get(f'/api/v1/receipts/{receipt.pk}')
    assert occupancy_response.status_code == receipt_response.status_code == 200
    assert {'id', 'unit', 'building', 'person', 'balance', 'movements'} <= set(
        occupancy_response.json()
    )
    assert {'id', 'person', 'building', 'unit', 'role', 'file', 'transfer_date'} <= set(
        receipt_response.json()
    )


def test_claim_detail_and_tasks_contract(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    claim = building.claims.first()
    claim_response = client.get(f'/api/v1/claims/{claim.pk}')
    tasks_response = client.get(f'/api/v1/organizations/{organization.pk}/tasks')

    assert claim_response.status_code == tasks_response.status_code == 200
    assert {'id', 'title', 'kind', 'unit', 'author', 'status', 'date', 'messages'} <= set(
        claim_response.json()
    )
    assert isinstance(tasks_response.json()['tasks'], list)


def test_portfolio_query_count_is_constant_when_buildings_are_added(demo):
    organization = demo.org_memberships.get().organization
    client = api_client_for(demo)
    with CaptureQueriesContext(connection) as initial_queries:
        get_portfolio(client, organization)

    for index in range(2):
        building = Building.objects.create(
            organization=organization, name=f'Nuevo {index}', address='Calle nueva'
        )
        unit = Unit.objects.create(
            building=building, number='1', floor=1, coefficient=Decimal('1.000000')
        )
        person = Person.objects.create(
            organization=organization, first_name=f'Persona {index}', last_name='Nueva'
        )
        Occupancy.objects.create(
            unit=unit, person=person, role=Occupancy.Role.OWNER,
            start_date=date(2026, 1, 1),
        )
        Settlement.objects.create(
            building=building, month=date(2026, 10, 1),
            status=Settlement.Status.ISSUED, issued_by=demo,
            issued_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        )

    with CaptureQueriesContext(connection) as expanded_queries:
        get_portfolio(client, organization)
    assert len(expanded_queries) == len(initial_queries)


def test_accounts_query_count_is_constant_when_occupancies_are_added(demo):
    organization = demo.org_memberships.get().organization
    building = organization.buildings.get(name='Edificio Minas')
    client = api_client_for(demo)
    with CaptureQueriesContext(connection) as initial_queries:
        response = client.get(
            f'/api/v1/buildings/{building.pk}/accounts?month=2026-10'
        )
    assert response.status_code == 200

    for index in range(10):
        unit = Unit.objects.create(
            building=building, number=f'new-{index}', floor=1,
            coefficient=Decimal('0.001000')
        )
        person = Person.objects.create(
            organization=organization, first_name=f'Cuenta {index}', last_name='Nueva'
        )
        Occupancy.objects.create(
            unit=unit, person=person, role=Occupancy.Role.OWNER,
            start_date=date(2026, 1, 1),
        )

    with CaptureQueriesContext(connection) as expanded_queries:
        response = client.get(
            f'/api/v1/buildings/{building.pk}/accounts?month=2026-10'
        )
    assert response.status_code == 200
    assert len(expanded_queries) == len(initial_queries)
