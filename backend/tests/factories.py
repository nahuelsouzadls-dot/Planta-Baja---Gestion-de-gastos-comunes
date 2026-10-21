from decimal import Decimal

import factory
from django.contrib.auth.models import User
from factory.django import DjangoModelFactory

from apps.buildings.models import Apartment, Building
from apps.expenses.models import MonthlyExpense
from apps.residents.models import Resident


class BuildingFactory(DjangoModelFactory):
    class Meta:
        model = Building

    name = factory.Sequence(lambda n: f"Edificio {n}")
    address = factory.Faker('street_address', locale='es')
    city = 'Montevideo'
    country = 'Uruguay'
    is_active = True


class ApartmentFactory(DjangoModelFactory):
    class Meta:
        model = Apartment

    building = factory.SubFactory(BuildingFactory)
    number = factory.Sequence(lambda n: str(100 + n))
    floor = factory.Sequence(lambda n: (n % 3) + 1)
    ownership_coefficient = Decimal('0.08333333')
    is_rented = False
    receives_paper = True


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User

    username = factory.Sequence(lambda n: f"user{n}")
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    first_name = factory.Faker('first_name', locale='es')
    last_name = factory.Faker('last_name', locale='es')


class ResidentFactory(DjangoModelFactory):
    class Meta:
        model = Resident

    user = factory.SubFactory(UserFactory)
    apartment = factory.SubFactory(ApartmentFactory)
    role = Resident.Role.OWNER
    is_active = True


class MonthlyExpenseFactory(DjangoModelFactory):
    class Meta:
        model = MonthlyExpense

    building = factory.SubFactory(BuildingFactory)
    billing_month = factory.Faker('date_object')
    ose_total = Decimal('1200.00')
    ute_total = Decimal('3400.00')
    cleaning_total = Decimal('4500.00')
    fees_total = Decimal('8000.00')
    extraordinary_total = Decimal('0.00')
    reserve_fund_total = Decimal('0.00')
    is_generated = False
