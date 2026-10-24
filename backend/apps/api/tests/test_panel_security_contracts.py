import json

import pytest
from django.core.management import call_command
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import OrgMembership, Organization, User
from apps.api.testing import api_client_for, assert_cross_org_404
from apps.ledger.models import Receipt


pytestmark = pytest.mark.django_db


PANEL_ROUTE_NAMES = (
    'portfolio',
    'accounts',
    'summary',
    'settlements',
    'notices',
    'claims',
    'claim_detail',
    'occupancy_detail',
    'receipt_detail',
    'tasks',
)

MONEY_KEYS = {
    'amount',
    'balance',
    'charge',
    'coefficient',
    'collected',
    'debt',
    'declared_amount',
    'expected',
    'in_review',
    'receivable',
    'reserve',
    'reserve_fund',
    'total',
}


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')
    return User.objects.get(email='maria@confort.demo')


def panel_routes(organization):
    building = organization.buildings.get(name='Edificio Minas')
    occupancy = building.units.get(number='101').occupancies.get(role='owner')
    receipt = Receipt.objects.filter(
        person__organization=organization, status=Receipt.Status.PENDING
    ).first()
    claim = building.claims.first()
    query = '?month=2026-10'
    return {
        'portfolio': f'/api/v1/organizations/{organization.pk}/portfolio{query}',
        'accounts': f'/api/v1/buildings/{building.pk}/accounts{query}',
        'summary': f'/api/v1/buildings/{building.pk}/summary{query}',
        'settlements': f'/api/v1/buildings/{building.pk}/settlements',
        'notices': f'/api/v1/buildings/{building.pk}/notices',
        'claims': f'/api/v1/buildings/{building.pk}/claims',
        'claim_detail': f'/api/v1/claims/{claim.pk}',
        'occupancy_detail': f'/api/v1/occupancies/{occupancy.pk}{query}',
        'receipt_detail': f'/api/v1/receipts/{receipt.pk}',
        'tasks': f'/api/v1/organizations/{organization.pk}/tasks',
    }


@pytest.fixture
def demo_context(demo):
    organization = demo.org_memberships.get().organization
    routes = panel_routes(organization)
    foreign_organization = Organization.objects.create(name='Otra organización')
    foreign_employee = User.objects.create_user(
        'otra-organizacion@example.com', password='password-12345'
    )
    OrgMembership.objects.create(
        user=foreign_employee, organization=foreign_organization
    )
    return organization, routes, foreign_employee


@pytest.mark.parametrize('route_name', PANEL_ROUTE_NAMES)
def test_panel_employee_cannot_read_foreign_organization(route_name, demo_context):
    _, routes, foreign_employee = demo_context
    assert_cross_org_404(api_client_for(foreign_employee), routes[route_name])


@pytest.mark.parametrize('route_name', PANEL_ROUTE_NAMES)
def test_resident_cannot_read_panel_endpoints(route_name, demo_context):
    organization, routes, _ = demo_context
    resident = User.objects.get(email='juan.perez@correo.com.uy')
    assert organization.buildings.exists()
    assert api_client_for(resident).get(routes[route_name]).status_code == 403


def walk_json(value, path=()):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk_json(item, path + (str(key),))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_json(item, path + (str(index),))
    else:
        yield path, value


@pytest.mark.parametrize('route_name', PANEL_ROUTE_NAMES)
def test_panel_serializes_amounts_and_coefficients_as_strings(route_name, demo_context, demo):
    _, routes, _ = demo_context
    response = api_client_for(demo).get(routes[route_name])
    assert response.status_code == 200
    payload = response.json()
    for path, value in walk_json(payload):
        key = path[-1].lower() if path else ''
        assert not isinstance(value, float), f'float at {".".join(path)}'
        if (
            key in MONEY_KEYS
            or key.endswith(('amount', 'balance', 'charge', 'coefficient', 'total'))
        ):
            assert not isinstance(value, int), f'int at {".".join(path)}'
            assert isinstance(value, str), f'non-string amount at {".".join(path)}'


def test_schema_and_docs_are_employee_only(demo):
    resident = User.objects.get(email='juan.perez@correo.com.uy')
    employee = api_client_for(demo)
    resident_client = api_client_for(resident)

    assert employee.get('/api/v1/schema').status_code == 200
    assert employee.get('/api/v1/docs').status_code == 200
    assert resident_client.get('/api/v1/schema').status_code == 403
    assert resident_client.get('/api/v1/docs').status_code == 403

    anonymous = APIClient()
    assert anonymous.get('/api/v1/schema').status_code == 403
    assert anonymous.get('/api/v1/docs').status_code == 403


@pytest.mark.parametrize('route_name', PANEL_ROUTE_NAMES)
def test_panel_responses_do_not_expose_sensitive_person_fields(route_name, demo_context, demo):
    _, routes, _ = demo_context
    response = api_client_for(demo).get(routes[route_name])
    assert response.status_code == 200
    body = json.dumps(response.json()).lower()
    for forbidden in ('password', 'token_hash', 'document'):
        assert forbidden not in body
