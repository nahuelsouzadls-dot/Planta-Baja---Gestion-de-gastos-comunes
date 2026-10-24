import factory
from datetime import timedelta
from django.utils import timezone
from django.contrib.auth.hashers import make_password
from factory.django import DjangoModelFactory

from apps.accounts.models import Invitation, OrgMembership, Organization, User
from apps.buildings.models import Building, ExpenseConcept, Unit
from apps.people.models import Occupancy, Person
from apps.settlements.models import Settlement, SettlementItem
from apps.ledger.models import LedgerEntry
from apps.communications.models import Claim, ClaimMessage, Notice, Task


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


class InvitationFactory(DjangoModelFactory):
    class Meta:
        model = Invitation

    organization = factory.SubFactory(OrganizationFactory)
    kind = Invitation.Kind.EMPLOYEE
    email = factory.Sequence(lambda n: f'invite{n}@example.com')
    token_hash = factory.Sequence(lambda n: f'{n:064d}')
    expires_at = factory.LazyFunction(lambda: timezone.now() + timedelta(hours=72))
    created_by = factory.SubFactory(UserFactory)


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


class LedgerEntryFactory(DjangoModelFactory):
    class Meta:
        model = LedgerEntry

    occupancy = factory.SubFactory(OccupancyFactory)
    date = '2026-10-01'
    kind = LedgerEntry.Kind.OPENING
    amount = '100.00'
    created_by = factory.SubFactory(UserFactory)


class NoticeFactory(DjangoModelFactory):
    class Meta:
        model = Notice

    building = factory.SubFactory(BuildingFactory)
    title = factory.Sequence(lambda n: f'Aviso {n}')
    body = 'Información importante para residentes.'
    published_by = factory.SubFactory(UserFactory)


class ClaimFactory(DjangoModelFactory):
    class Meta:
        model = Claim

    building = factory.SubFactory(BuildingFactory)
    unit = factory.LazyAttribute(lambda claim: UnitFactory(building=claim.building))
    author = factory.LazyAttribute(
        lambda claim: PersonFactory(organization=claim.building.organization)
    )
    kind = Claim.Kind.REPORT
    title = factory.Sequence(lambda n: f'Reclamo {n}')
    status = Claim.Status.PENDING


class ClaimMessageFactory(DjangoModelFactory):
    class Meta:
        model = ClaimMessage

    claim = factory.SubFactory(ClaimFactory)
    author = factory.SubFactory(UserFactory)
    from_admin = False
    text = 'Mensaje del reclamo.'


class TaskFactory(DjangoModelFactory):
    class Meta:
        model = Task

    building = factory.SubFactory(BuildingFactory)
    organization = factory.LazyAttribute(lambda task: task.building.organization)
    text = factory.Sequence(lambda n: f'Tarea {n}')
    created_by = factory.SubFactory(UserFactory)
