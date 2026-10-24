import factory
from django.contrib.auth.hashers import make_password
from factory.django import DjangoModelFactory

from apps.accounts.models import OrgMembership, Organization, User


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
