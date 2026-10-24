import factory
from django.contrib.auth.hashers import make_password
from factory.django import DjangoModelFactory

from apps.accounts.models import OrgMembership, Organization, User
from apps.buildings.models import Building, ExpenseConcept, Unit
from apps.people.models import Occupancy, Person
from apps.settlements.models import Settlement, SettlementItem


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User

    email = factory.Sequence(lambda n: f'user{n}@example.com')
    password = factory.LazyFunction(lambda: make_password('test-password-123'))
    first_name = factory.Faker('first_name', locale='es')
    last_name = factory.Faker('last_name', locale='es')


class OrganizationFactory(DjangoModelFactory):
    class Meta:
        model = Organization

    name = factory.Sequence(lambda n: f'Organización {n}')
    email = factory.Sequence(lambda n: f'org{n}@example.com')


class OrgMembershipFactory(DjangoModelFactory):
    class Meta:
        model = OrgMembership

    user = factory.SubFactory(UserFactory)
    organization = factory.SubFactory(OrganizationFactory)


class BuildingFactory(DjangoModelFactory):
    class Meta:
        model = Building

    organization = factory.SubFactory(OrganizationFactory)
    name = factory.Sequence(lambda n: f'Edificio {n}')
    address = factory.Sequence(lambda n: f'Calle {n} 1234')


class UnitFactory(DjangoModelFactory):
    class Meta:
        model = Unit

    building = factory.SubFactory(BuildingFactory)
    number = factory.Sequence(lambda n: str(n + 1))
    floor = 1
    coefficient = '0.086000'


class ExpenseConceptFactory(DjangoModelFactory):
    class Meta:
        model = ExpenseConcept

    building = factory.SubFactory(BuildingFactory)
    name = factory.Sequence(lambda n: f'Concepto {n}')
    kind = ExpenseConcept.Kind.ORDINARY


class PersonFactory(DjangoModelFactory):
    class Meta:
        model = Person

    organization = factory.SubFactory(OrganizationFactory)
    first_name = factory.Faker('first_name', locale='es')
    last_name = factory.Faker('last_name', locale='es')
    email = factory.Sequence(lambda n: f'person{n}@example.com')


class OccupancyFactory(DjangoModelFactory):
    class Meta:
        model = Occupancy

    unit = factory.SubFactory(UnitFactory)
    person = factory.LazyAttribute(
        lambda occupancy: PersonFactory(organization=occupancy.unit.building.organization)
    )
    role = Occupancy.Role.TENANT
    start_date = factory.Faker('date_object')
    end_date = None


class SettlementFactory(DjangoModelFactory):
    class Meta:
        model = Settlement

    building = factory.SubFactory(BuildingFactory)
    month = '2026-10-01'
    status = Settlement.Status.DRAFT


class SettlementItemFactory(DjangoModelFactory):
    class Meta:
        model = SettlementItem

    settlement = factory.SubFactory(SettlementFactory)
    concept = factory.LazyAttribute(
        lambda item: ExpenseConceptFactory(building=item.settlement.building)
    )
    amount = '100.00'
