import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.accounts.invitations import accept_invitation, invite_employee, invite_resident
from apps.accounts.models import Invitation, OrgMembership, User
from tests.factories import OrganizationFactory, OrgMembershipFactory, PersonFactory


@pytest.mark.django_db
def test_accepting_resident_invitation_links_person_and_records_audit():
    organization = OrganizationFactory()
    user = User.objects.create_user('service@example.com', 'Correct horse battery staple 123')
    OrgMembershipFactory(user=user, organization=organization)
    invitation, token = invite_employee(
        organization, user, email='service-invite@example.com',
        first_name='Servicio', last_name='Admin',
    )
    assert Invitation.objects.filter(pk=invitation.pk).exists()
    accepted = accept_invitation(token, 'Correct horse battery staple 123')
    assert accepted.email == 'service-invite@example.com'
    assert OrgMembership.objects.filter(
        user=accepted, organization=organization
    ).exists()


@pytest.mark.django_db
def test_accepting_resident_invitation_links_person():
    organization = OrganizationFactory()
    admin = User.objects.create_user(
        'resident-admin@example.com', 'Correct horse battery staple 123'
    )
    OrgMembershipFactory(user=admin, organization=organization)
    person = PersonFactory(organization=organization, email='resident-link@example.com')
    invitation, token = invite_resident(person, admin)

    accepted = accept_invitation(token, 'Correct horse battery staple 123')
    person.refresh_from_db()
    invitation.refresh_from_db()
    assert invitation.used_at is not None
    assert person.user_id == accepted.pk


@pytest.mark.django_db
def test_expired_invitation_has_generic_error():
    organization = OrganizationFactory()
    user = User.objects.create_user('expiry@example.com', 'Correct horse battery staple 123')
    OrgMembershipFactory(user=user, organization=organization)
    invitation, token = invite_employee(
        organization, user, email='expired-service@example.com',
        first_name='Expirado', last_name='Test',
    )
    invitation.expires_at = timezone.now()
    invitation.save(update_fields=['expires_at'])
    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        accept_invitation(token, 'Correct horse battery staple 123')


@pytest.mark.django_db
def test_existing_user_wrong_password_does_not_link_membership():
    organization = OrganizationFactory()
    admin = User.objects.create_user(
        'wrong-password-admin@example.com', 'Correct horse battery staple 123'
    )
    existing = User.objects.create_user(
        'existing-wrong@example.com', 'Correct horse battery staple 123'
    )
    OrgMembershipFactory(user=admin, organization=organization)
    invitation, token = invite_employee(
        organization, admin, email=existing.email, first_name='A', last_name='B'
    )

    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        accept_invitation(token, 'Another secure password 123')
    assert not OrgMembership.objects.filter(
        user=existing, organization=organization
    ).exists()
    invitation.refresh_from_db()
    assert invitation.used_at is None
