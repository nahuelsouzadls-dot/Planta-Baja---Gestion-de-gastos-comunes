import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.accounts.models import OrgMembership, Organization

User = get_user_model()


@pytest.mark.django_db
def test_create_user_normalizes_email():
    user = User.objects.create_user('  Ana@Example.COM ', 'strong-password')
    assert user.email == 'ana@example.com'


@pytest.mark.django_db
def test_duplicate_case_insensitive_email_is_rejected():
    User.objects.create_user('Ana@example.com', 'strong-password')
    with pytest.raises(IntegrityError):
        User.objects.create_user('ana@example.com', 'another-password')


def test_create_user_without_email_raises():
    with pytest.raises(ValueError):
        User.objects.create_user('', 'strong-password')
    with pytest.raises(ValueError):
        User.objects.create_user('   ', 'strong-password')


@pytest.mark.django_db
def test_create_superuser_sets_admin_flags():
    user = User.objects.create_superuser('admin@example.com', 'strong-password')
    assert user.is_staff is True
    assert user.is_superuser is True


@pytest.mark.django_db
def test_membership_is_unique():
    user = User.objects.create_user('member@example.com', 'strong-password')
    organization = Organization.objects.create(name='Administración Demo')
    OrgMembership.objects.create(user=user, organization=organization)
    with pytest.raises(IntegrityError):
        OrgMembership.objects.create(user=user, organization=organization)


@pytest.mark.django_db
def test_email_database_constraint_requires_lowercase_and_nonempty():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            User.objects.create(email='', password='unused')
    user = User.objects.create_user('valid@example.com', 'strong-password')
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            User.objects.filter(pk=user.pk).update(email='Valid@Example.com')
