import re
from urllib.parse import parse_qs, urlparse

import pytest
from django.core import mail
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Invitation, OrgMembership, User
from apps.audit.models import AuditLog
from apps.buildings.models import Unit
from apps.people.models import Occupancy, Person
from tests.factories import (
    BuildingFactory,
    OccupancyFactory,
    OrganizationFactory,
    OrgMembershipFactory,
    PersonFactory,
    UnitFactory,
)


PASSWORD = 'Correct horse battery staple 123'


@pytest.fixture(autouse=True)
def locmem_email_backend():
    with override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'):
        yield


def csrf_client():
    client = APIClient(enforce_csrf_checks=True)
    response = client.get('/api/v1/auth/csrf')
    assert response.status_code == 204
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    return client


def login(client, email, password=PASSWORD, ip='10.50.0.1'):
    response = client.post(
        '/api/v1/auth/login',
        {'email': email, 'password': password},
        format='json',
        REMOTE_ADDR=ip,
    )
    if response.status_code == 200:
        client.get('/api/v1/auth/csrf')
        client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    return response


def post_with_commit(client, path, data):
    with TestCase.captureOnCommitCallbacks(execute=True):
        return client.post(path, data, format='json')


def create_user(email, password=PASSWORD, **kwargs):
    return User.objects.create_user(email, password, **kwargs)


@pytest.mark.django_db
def test_login_success_csrf_and_normalization():
    user = create_user('ana@example.com')
    client = csrf_client()

    assert login(client, ' ANA@EXAMPLE.COM ') .status_code == 200
    assert client.get('/api/v1/auth/me').json()['email'] == user.email

    no_csrf = APIClient(enforce_csrf_checks=True)
    assert no_csrf.post(
        '/api/v1/auth/login',
        {'email': user.email, 'password': PASSWORD},
        format='json',
    ).status_code == 403

    bad = csrf_client()
    wrong = login(bad, user.email, 'wrong password', '10.50.0.2')
    unknown = login(bad, 'missing@example.com', 'wrong password', '10.50.0.3')
    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json()['detail'] == unknown.json()['detail'] == 'Email o contraseña incorrectos'


@pytest.mark.django_db
def test_login_axes_sixth_attempt_is_rejected():
    user = create_user('locked@example.com')
    client = csrf_client()
    for attempt in range(4):
        assert login(client, user.email, 'bad password', '10.51.0.9').status_code == 400
    assert login(client, user.email, 'bad password', '10.51.0.9').status_code == 429
    assert login(client, user.email, PASSWORD, '10.51.0.9').status_code == 429


@pytest.mark.django_db
def test_me_requires_session_and_returns_memberships_and_occupancies_without_password():
    user = create_user('resident@example.com')
    organization = OrganizationFactory()
    OrgMembershipFactory(user=user, organization=organization)
    building = BuildingFactory(organization=organization)
    unit = UnitFactory(building=building)
    person = PersonFactory(organization=organization, user=user)
    OccupancyFactory(unit=unit, person=person)
    client = csrf_client()

    assert client.get('/api/v1/auth/me').status_code == 403
    assert login(client, user.email).status_code == 200
    response = client.get('/api/v1/auth/me')
    assert response.status_code == 200
    payload = response.json()
    assert payload['organizations'][0]['id'] == str(organization.pk)
    assert payload['persons'][0]['occupancies'][0]['unit_number'] == unit.number
    assert 'password' not in str(payload)


@pytest.mark.django_db
def test_logout_invalidates_session():
    user = create_user('logout@example.com')
    client = csrf_client()
    assert login(client, user.email).status_code == 200
    assert client.post('/api/v1/auth/logout', format='json').status_code == 204
    assert client.get('/api/v1/auth/me').status_code == 403


@pytest.mark.django_db
def test_employee_invitation_authorization_and_organization_selection():
    organization = OrganizationFactory()
    employee = create_user('employee@example.com')
    OrgMembershipFactory(user=employee, organization=organization)
    other = OrganizationFactory()
    outsider = create_user('outsider@example.com')
    OrgMembershipFactory(user=outsider, organization=other)
    client = csrf_client()
    assert login(client, employee.email).status_code == 200

    response = post_with_commit(client, '/api/v1/invitations/employees', {
        'organization_id': str(organization.pk), 'email': 'new@example.com',
        'first_name': 'Nuevo', 'last_name': 'Empleado',
    })
    assert response.status_code == 201
    assert len(mail.outbox) == 1
    assert 'aceptar-invitacion?token=' in mail.outbox[0].body

    outsider_client = csrf_client()
    assert login(outsider_client, outsider.email, ip='10.52.0.1').status_code == 200
    assert outsider_client.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(organization.pk), 'email': 'nope@example.com',
         'first_name': 'No', 'last_name': 'Permitido'},
        format='json',
    ).status_code in (403, 400, 404)

    person = PersonFactory(organization=organization, email='resident@example.com')
    assert post_with_commit(
        client, '/api/v1/invitations/residents', {'person_id': str(person.pk)}
    ).status_code == 201

    multi = create_user('multi@example.com')
    OrgMembershipFactory(user=multi, organization=organization)
    OrgMembershipFactory(user=multi, organization=other)
    multi_client = csrf_client()
    assert login(multi_client, multi.email, ip='10.52.0.2').status_code == 200
    assert multi_client.post(
        '/api/v1/invitations/employees',
        {'email': 'ambiguous@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    ).status_code == 400


@pytest.mark.django_db
def test_resident_invitation_rejects_foreign_person_missing_email_and_existing_account():
    organization = OrganizationFactory()
    admin = create_user('admin-resident@example.com')
    OrgMembershipFactory(user=admin, organization=organization)
    foreign = PersonFactory(organization=OrganizationFactory())
    no_email = PersonFactory(organization=organization, email='')
    existing = PersonFactory(organization=organization, user=create_user('linked@example.com'))
    client = csrf_client()
    assert login(client, admin.email, ip='10.53.0.1').status_code == 200

    assert client.post(
        '/api/v1/invitations/residents', {'person_id': str(foreign.pk)}, format='json'
    ).status_code == 404
    assert client.post(
        '/api/v1/invitations/residents', {'person_id': str(no_email.pk)}, format='json'
    ).status_code == 400
    assert client.post(
        '/api/v1/invitations/residents', {'person_id': str(existing.pk)}, format='json'
    ).status_code == 400


def invitation_token(email):
    message = next(message for message in mail.outbox if email in message.to)
    return parse_qs(urlparse(re.search(r'(https?://\S+)', message.body).group(1)).query)['token'][0]


@pytest.mark.django_db
def test_invitation_acceptance_replay_expiry_revoke_weak_password_and_audit():
    organization = OrganizationFactory()
    admin = create_user('invite-admin@example.com')
    OrgMembershipFactory(user=admin, organization=organization)
    client = csrf_client()
    assert login(client, admin.email, ip='10.54.0.1').status_code == 200
    assert post_with_commit(
        client, '/api/v1/invitations/employees',
        {'organization_id': str(organization.pk), 'email': 'accepted@example.com',
         'first_name': 'A', 'last_name': 'B'},
    ).status_code == 201
    token = invitation_token('accepted@example.com')
    accept = csrf_client()
    response = accept.post(
        '/api/v1/invitations/accept', {'token': token, 'password': PASSWORD},
        format='json',
    )
    assert response.status_code == 200
    assert accept.get('/api/v1/auth/me').status_code == 200
    accept.get('/api/v1/auth/csrf')
    accept.credentials(HTTP_X_CSRFTOKEN=accept.cookies['csrftoken'].value)
    replay = accept.post(
        '/api/v1/invitations/accept', {'token': token, 'password': PASSWORD},
        format='json',
    )
    assert replay.status_code == 400
    assert 'El link no es válido o venció' in replay.json()['detail']

    for email in ('expired@example.com', 'revoked@example.com', 'weak@example.com'):
        assert post_with_commit(
            client, '/api/v1/invitations/employees',
            {'organization_id': str(organization.pk), 'email': email,
             'first_name': 'A', 'last_name': 'B'},
        ).status_code == 201
    expired = Invitation.objects.get(email='expired@example.com')
    expired.expires_at = expired.created_at
    expired.save(update_fields=['expires_at'])
    assert csrf_client().post(
        '/api/v1/invitations/accept',
        {'token': invitation_token('expired@example.com'), 'password': PASSWORD},
        format='json',
    ).status_code == 400
    revoked = Invitation.objects.get(email='revoked@example.com')
    revoked.revoked_at = revoked.created_at
    revoked.save(update_fields=['revoked_at'])
    assert csrf_client().post(
        '/api/v1/invitations/accept',
        {'token': invitation_token('revoked@example.com'), 'password': PASSWORD},
        format='json',
    ).status_code == 400
    weak = csrf_client().post(
        '/api/v1/invitations/accept',
        {'token': invitation_token('weak@example.com'), 'password': 'short'},
        format='json',
    )
    assert weak.status_code == 400
    assert AuditLog.objects.filter(action__startswith='invitation.').count() >= 4
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM accounts_invitation WHERE token_hash = %s",
            [token],
        )
        assert cursor.fetchone()[0] == 0
        cursor.execute(
            "SELECT count(*) FROM audit_rowchange WHERE new_values::text LIKE %s",
            [f'%{token}%'],
        )
        assert cursor.fetchone()[0] == 0


@pytest.mark.django_db
def test_existing_user_invitation_requires_matching_password_and_preserves_hash():
    organization = OrganizationFactory()
    admin = create_user('existing-admin@example.com')
    existing = create_user('already@example.com')
    OrgMembershipFactory(user=admin, organization=organization)
    client = csrf_client()
    assert login(client, admin.email, ip='10.55.0.1').status_code == 200
    assert post_with_commit(
        client, '/api/v1/invitations/employees',
        {'organization_id': str(organization.pk), 'email': existing.email,
         'first_name': 'A', 'last_name': 'B'},
    ).status_code == 201
    token = invitation_token(existing.email)
    old_hash = User.objects.get(pk=existing.pk).password
    assert csrf_client().post(
        '/api/v1/invitations/accept', {'token': token, 'password': PASSWORD},
        format='json',
    ).status_code == 200
    existing.refresh_from_db()
    assert existing.password == old_hash
    assert OrgMembership.objects.filter(user=existing, organization=organization).exists()


@pytest.mark.django_db
def test_password_reset_is_enumeration_safe_and_changes_password():
    user = create_user('reset@example.com')
    existing = csrf_client()
    assert post_with_commit(
        existing, '/api/v1/auth/password-reset', {'email': user.email}
    ).status_code == 204
    assert post_with_commit(
        csrf_client(), '/api/v1/auth/password-reset', {'email': 'absent@example.com'}
    ).status_code == 204
    assert len(mail.outbox) == 1
    query = parse_qs(urlparse(re.search(r'(https?://\S+)', mail.outbox[0].body).group(1)).query)
    confirm = csrf_client().post(
        '/api/v1/auth/password-reset/confirm',
        {'uid': query['uid'][0], 'token': query['token'][0], 'password': 'New secure password 123'},
        format='json',
    )
    assert confirm.status_code == 204
    assert login(csrf_client(), user.email, 'New secure password 123', '10.56.0.1').status_code == 200
    for altered in ('altered', query['token'][0]):
        assert csrf_client().post(
            '/api/v1/auth/password-reset/confirm',
            {'uid': query['uid'][0], 'token': altered, 'password': 'Another secure password 123'},
            format='json',
        ).status_code == 400


@pytest.mark.django_db
@override_settings(REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework.authentication.SessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.ScopedRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {'login': '10/min', 'invitation_accept': '10/hour', 'password_reset': '5/hour'},
})
def test_login_throttle_rejects_eleventh_request_from_same_ip():
    for index in range(11):
        create_user(f'throttle-{index}@example.com')
    client = csrf_client()
    responses = [
        login(client, f'throttle-{index}@example.com', 'bad password', '10.57.0.1')
        for index in range(11)
    ]
    assert responses[-1].status_code == 429
