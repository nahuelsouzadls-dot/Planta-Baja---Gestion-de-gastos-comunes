from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth.models import User

from apps.buildings.models import Apartment, Building
from apps.expenses.models import MonthlyExpense
from apps.residents.models import Resident


@pytest.fixture
def building(db):
    return Building.objects.create(
        name='Edificio Confort',
        address='Av. Brasil 2234',
        city='Montevideo',
        country='Uruguay',
    )


@pytest.fixture
def apartment(db, building):
    return Apartment.objects.create(
        building=building,
        number='101',
        floor=1,
        ownership_coefficient=Decimal('0.08333333'),
    )


@pytest.fixture
def owner_user(db):
    return User.objects.create_user(
        username='propietario1',
        email='prop1@example.com',
        password='testpass123',
    )


@pytest.fixture
def tenant_user(db):
    return User.objects.create_user(
        username='inquilino1',
        email='inq1@example.com',
        password='testpass123',
    )


@pytest.fixture
def owner_resident(db, owner_user, apartment):
    return Resident.objects.create(
        user=owner_user,
        apartment=apartment,
        role=Resident.Role.OWNER,
    )


@pytest.fixture
def tenant_resident(db, tenant_user, building):
    apartment_102 = Apartment.objects.create(
        building=building,
        number='102',
        floor=1,
        ownership_coefficient=Decimal('0.08333333'),
    )
    return Resident.objects.create(
        user=tenant_user,
        apartment=apartment_102,
        role=Resident.Role.TENANT,
    )


@pytest.fixture
def monthly_expense(db, building):
    return MonthlyExpense.objects.create(
        building=building,
        billing_month=date(2026, 10, 1),
        ose_total=Decimal('1200.00'),
        ute_total=Decimal('3400.00'),
        cleaning_total=Decimal('4500.00'),
        fees_total=Decimal('8000.00'),
        extraordinary_total=Decimal('0.00'),
        reserve_fund_total=Decimal('0.00'),
    )
