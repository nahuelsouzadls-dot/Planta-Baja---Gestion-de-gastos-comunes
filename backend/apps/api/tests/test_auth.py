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
    from django.core.cache import cache

    cache.clear()
    with override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'):
        yield
    cache.clear()


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


@pytest.mark.django_db
def test_sec3_1_resident_invitation_revoked_on_email_change_and_rejects_stale_email():
    from django.core.exceptions import ValidationError
    from apps.accounts.invitations import accept_invitation, invite_resident
    from apps.people.services import update_person

    org = OrganizationFactory(name='Confort S.A.')
    admin = create_user('sec3-admin1@confort.com')
    OrgMembershipFactory(user=admin, organization=org)

    person = PersonFactory(
        organization=org,
        first_name='Lucía',
        last_name='Gómez',
        email='equivocado@example.com',
    )
    inv_old, token_old = invite_resident(person, admin)

    person = update_person(person, admin, email='lucia.real@example.com')
    inv_old.refresh_from_db()
    assert inv_old.revoked_at is not None

    inv_second, token_second = invite_resident(person, admin)
    # Si el email de la persona cambia en la base sin pasar por update_person,
    # accept_invitation igual debe rechazar el token porque invitation.email != person.email:
    Person.objects.filter(pk=person.pk).update(email='lucia.final@example.com')
    person.refresh_from_db()
    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        accept_invitation(token_second, PASSWORD)

    inv_new, token_new = invite_resident(person, admin)
    inv_second.refresh_from_db()
    assert inv_second.revoked_at is not None

    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        accept_invitation(token_old, PASSWORD)

    accepted_user = accept_invitation(token_new, PASSWORD)
    person.refresh_from_db()
    assert accepted_user.email == 'lucia.final@example.com'
    assert accepted_user.first_name == 'Lucía'
    assert accepted_user.last_name == 'Gómez'
    assert person.user_id == accepted_user.pk


@pytest.mark.django_db
@override_settings(REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework.authentication.SessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.ScopedRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
        'invitation_accept': '10/hour',
        'password_reset': '5/hour',
    },
})
def test_sec3_2_client_ip_trusted_proxies_prevents_throttle_bypass_and_axes_cross_blocking(rf):
    from django.core.cache import cache
    from apps.audit.models import RowChange
    from apps.core.net import client_ip

    cache.clear()
    req_direct = rf.get('/', REMOTE_ADDR='10.0.0.1', HTTP_X_FORWARDED_FOR='203.0.113.5')
    with override_settings(TRUSTED_PROXY_COUNT=0):
        assert client_ip(req_direct) == '10.0.0.1'

    req_spoofed = rf.get(
        '/',
        REMOTE_ADDR='10.0.0.1',
        HTTP_X_FORWARDED_FOR='203.0.113.9, 198.51.100.77',
    )
    with override_settings(TRUSTED_PROXY_COUNT=1):
        assert client_ip(req_spoofed) == '198.51.100.77'

    with override_settings(TRUSTED_PROXY_COUNT=2):
        req_short = rf.get('/', REMOTE_ADDR='10.0.0.1', HTTP_X_FORWARDED_FOR='198.51.100.77')
        assert client_ip(req_short) == '10.0.0.1'

    client = csrf_client()
    for i in range(5):
        res = client.post(
            '/api/v1/auth/password-reset',
            {'email': f'user{i}@example.com'},
            format='json',
            REMOTE_ADDR='10.0.0.1',
            HTTP_X_FORWARDED_FOR=f'203.0.113.{i}, 198.51.100.77',
        )
        assert res.status_code == 204

    sixth = client.post(
        '/api/v1/auth/password-reset',
        {'email': 'user5@example.com'},
        format='json',
        REMOTE_ADDR='10.0.0.1',
        HTTP_X_FORWARDED_FOR='203.0.113.99, 198.51.100.77',
    )
    assert sixth.status_code == 429

    cache.clear()
    victim = create_user('victim-sec3@example.com')
    with override_settings(TRUSTED_PROXY_COUNT=1):
        # Un atacante detrás del proxy (REMOTE_ADDR='10.0.0.2') con IP real 198.51.100.50
        # falsifica la parte izquierda de X-Forwarded-For pero sigue siendo identificado como 198.51.100.50:
        for i in range(4):
            res = client.post(
                '/api/v1/auth/login',
                {'email': victim.email, 'password': 'wrong-password'},
                format='json',
                REMOTE_ADDR='10.0.0.2',
                HTTP_X_FORWARDED_FOR=f'198.18.0.{i}, 198.51.100.50',
            )
            assert res.status_code == 400

        fifth_fail = client.post(
            '/api/v1/auth/login',
            {'email': victim.email, 'password': 'wrong-password'},
            format='json',
            REMOTE_ADDR='10.0.0.2',
            HTTP_X_FORWARDED_FOR='198.18.0.99, 198.51.100.50',
        )
        assert fifth_fail.status_code == 429

        # Otro cliente legítimo detrás del mismo proxy (REMOTE_ADDR='10.0.0.2') pero con IP real 198.51.100.200
        # NO queda bloqueado por axes y AuditContextMiddleware registra su IP real:
        legit_client = csrf_client()
        legit_res = legit_client.post(
            '/api/v1/auth/login',
            {'email': victim.email, 'password': PASSWORD},
            format='json',
            REMOTE_ADDR='10.0.0.2',
            HTTP_X_FORWARDED_FOR='198.51.100.200',
        )
        assert legit_res.status_code == 200
        login_change = RowChange.objects.filter(
            table_name='accounts_user',
            row_id=victim.pk,
            operation=RowChange.Operation.UPDATE,
        ).latest('created_at')
        assert login_change.request_ip == '198.51.100.200'


@pytest.mark.django_db
def test_sec3_3_invitation_accept_enforces_axes_rejects_inactive_user_and_validates_similarity():
    from django.core.exceptions import ValidationError
    from apps.accounts.invitations import accept_invitation, invite_employee

    org = OrganizationFactory(name='Org Sec3')
    admin = create_user('admin-sec3-3@org.com')
    OrgMembershipFactory(user=admin, organization=org)

    inactive_user = create_user('inactive-sec3@example.com', is_active=False)
    _, token_inactive = invite_employee(
        org, admin, email=inactive_user.email, first_name='In', last_name='Activo'
    )
    client = csrf_client()
    # Un usuario inactivo no puede aceptar invitación ni iniciar sesión aunque envíe la contraseña correcta:
    res_inactive = client.post(
        '/api/v1/invitations/accept',
        {'token': token_inactive, 'password': PASSWORD},
        format='json',
        REMOTE_ADDR='10.99.0.1',
    )
    assert res_inactive.status_code == 400
    assert not OrgMembership.objects.filter(user=inactive_user, organization=org).exists()

    # Para un usuario activo existente, axes cuenta los fallos y bloquea al 5to intento:
    active_existing = create_user('existing-sec3@example.com')
    _, token_existing = invite_employee(
        org, admin, email=active_existing.email, first_name='Ex', last_name='Isting'
    )
    for i in range(4):
        res = client.post(
            '/api/v1/invitations/accept',
            {'token': token_existing, 'password': f'WrongPassword-{i}-12345'},
            format='json',
            REMOTE_ADDR='10.99.0.2',
        )
        assert res.status_code == 400

    fifth = client.post(
        '/api/v1/invitations/accept',
        {'token': token_existing, 'password': 'WrongPassword-4-12345'},
        format='json',
        REMOTE_ADDR='10.99.0.2',
    )
    assert fifth.status_code == 429

    # UserAttributeSimilarityValidator rechaza contraseñas similares al email/nombre del invitado:
    _, token_new = invite_employee(
        org, admin, email='similar-user@example.com', first_name='Similar', last_name='User'
    )
    with pytest.raises(ValidationError):
        accept_invitation(token_new, 'similar-user@example.com')

    # Un token inválido con contraseña corta devuelve el mensaje genérico de invitación inválida:
    bad_token_weak = client.post(
        '/api/v1/invitations/accept',
        {'token': 'invalid-token-value', 'password': 'short'},
        format='json',
        REMOTE_ADDR='10.99.0.3',
    )
    assert bad_token_weak.status_code == 400
    assert bad_token_weak.json()['detail'] == 'El link no es válido o venció'


@pytest.mark.django_db
def test_sec3_5_session_key_rotates_on_every_auth_and_audit_actor_is_accurate():
    from apps.accounts.invitations import invite_employee
    from apps.audit.models import RowChange

    org = OrganizationFactory(name='Org Audit Sec3')
    user_a = create_user('user_a_sec3@example.com')
    OrgMembershipFactory(user=user_a, organization=org)

    client = csrf_client()
    res1 = client.post(
        '/api/v1/auth/login',
        {'email': user_a.email, 'password': PASSWORD},
        format='json',
    )
    assert res1.status_code == 200
    session_1 = client.cookies['sessionid'].value

    login_change = RowChange.objects.filter(
        table_name='accounts_user',
        row_id=user_a.pk,
        operation=RowChange.Operation.UPDATE,
    ).latest('created_at')
    assert login_change.actor == user_a

    # Re-login con sesión ya activa del mismo usuario rota el sessionid:
    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    res2 = client.post(
        '/api/v1/auth/login',
        {'email': user_a.email, 'password': PASSWORD},
        format='json',
    )
    assert res2.status_code == 200
    session_2 = client.cookies['sessionid'].value
    assert session_2 != session_1

    # Aceptar invitación para el mismo usuario con sesión abierta también rota el sessionid:
    org_2 = OrganizationFactory(name='Org 2 Sec3')
    admin_2 = create_user('admin2_sec3@example.com')
    OrgMembershipFactory(user=admin_2, organization=org_2)
    _, token_a = invite_employee(
        org_2, admin_2, email=user_a.email, first_name='User', last_name='A'
    )
    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    res_accept_same = client.post(
        '/api/v1/invitations/accept',
        {'token': token_a, 'password': PASSWORD},
        format='json',
    )
    assert res_accept_same.status_code == 200
    session_3 = client.cookies['sessionid'].value
    assert session_3 != session_2

    # Si en el mismo navegador con sesión de user_a un usuario nuevo user_b acepta invitación,
    # el INSERT en accounts_user queda con actor=user_b y organization_id=org.pk (no user_a):
    _, token_b = invite_employee(
        org, user_a, email='user_b_sec3@example.com', first_name='User', last_name='B'
    )
    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    res_accept_b = client.post(
        '/api/v1/invitations/accept',
        {'token': token_b, 'password': PASSWORD},
        format='json',
    )
    assert res_accept_b.status_code == 200
    user_b = User.objects.get(email='user_b_sec3@example.com')
    insert_b = RowChange.objects.get(
        table_name='accounts_user',
        row_id=user_b.pk,
        operation=RowChange.Operation.INSERT,
    )
    assert insert_b.actor == user_b
    assert insert_b.organization_id == org.pk


@pytest.mark.django_db
def test_sec3_6_password_reset_rejects_inactive_user_invalidates_other_sessions_and_uses_on_commit_helper(monkeypatch):
    from django.contrib.auth.tokens import PasswordResetTokenGenerator
    from django.contrib.sessions.models import Session
    from django.core.exceptions import ValidationError
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode
    from apps.accounts import invitations as invitations_module
    from apps.accounts.invitations import confirm_password_reset
    from apps.audit.models import RowChange

    active_user = create_user('active-reset-sec3@example.com')
    inactive_user = create_user('inactive-reset-sec3@example.com', is_active=False)

    # 1) Usuario inactivo no puede cambiar contraseña aunque tenga un token:
    inactive_token = PasswordResetTokenGenerator().make_token(inactive_user)
    inactive_uid = urlsafe_base64_encode(force_bytes(inactive_user.pk))
    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        confirm_password_reset(inactive_uid, inactive_token, 'NewValidPassword123!')
    inactive_user.refresh_from_db()
    assert not inactive_user.check_password('NewValidPassword123!')

    # 2) uid no-UUID devuelve mensaje genérico y no filtra ValidationError de UUIDField:
    client = csrf_client()
    bad_uid = urlsafe_base64_encode(b'123')
    res_bad_uid = client.post(
        '/api/v1/auth/password-reset/confirm',
        {'uid': bad_uid, 'token': 'any-token', 'password': 'NewValidPassword123!'},
        format='json',
    )
    assert res_bad_uid.status_code == 400
    assert res_bad_uid.json()['detail'] == 'El link no es válido o venció'
    assert 'UUID' not in res_bad_uid.json()['detail']

    # 3) request_password_reset usa send_password_reset_email en on_commit:
    assert hasattr(invitations_module, 'send_password_reset_email')
    calls = []
    monkeypatch.setattr(
        invitations_module,
        'send_password_reset_email',
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )
    with TestCase.captureOnCommitCallbacks(execute=True):
        client.post(
            '/api/v1/auth/password-reset',
            {'email': inactive_user.email},
            format='json',
        )
    assert calls == []
    with TestCase.captureOnCommitCallbacks(execute=True):
        client.post(
            '/api/v1/auth/password-reset',
            {'email': active_user.email},
            format='json',
        )
    assert len(calls) == 1

    # 4) Al cambiar la contraseña se invalidan las demás sesiones del usuario y queda actor=active_user:
    other_device = csrf_client()
    assert login(other_device, active_user.email, PASSWORD, ip='10.60.0.1').status_code == 200
    other_session_key = other_device.cookies['sessionid'].value
    assert Session.objects.filter(session_key=other_session_key).exists()
    active_user.refresh_from_db()

    active_token = PasswordResetTokenGenerator().make_token(active_user)
    active_uid = urlsafe_base64_encode(force_bytes(active_user.pk))
    res_confirm = client.post(
        '/api/v1/auth/password-reset/confirm',
        {'uid': active_uid, 'token': active_token, 'password': 'NewValidPassword123!'},
        format='json',
    )
    assert res_confirm.status_code == 204
    assert not Session.objects.filter(session_key=other_session_key).exists()
    assert other_device.get('/api/v1/auth/me').status_code == 403

    pw_change = RowChange.objects.filter(
        table_name='accounts_user',
        row_id=active_user.pk,
        operation=RowChange.Operation.UPDATE,
    ).latest('created_at')
    assert pw_change.actor == active_user


@pytest.mark.django_db
def test_sec3_7_malformed_inputs_never_500_and_status_codes_aligned():
    from apps.api.testing import api_client_for

    org_a = OrganizationFactory(name='Org A Sec3')
    org_b = OrganizationFactory(name='Org B Sec3')
    emp_a = create_user('emp_a_sec3@example.com')
    OrgMembershipFactory(user=emp_a, organization=org_a)

    resident_user = create_user('res_sec3@example.com')
    building_a = BuildingFactory(organization=org_a)
    unit_a = UnitFactory(building=building_a)
    resident_person = PersonFactory(organization=org_a, user=resident_user)
    OccupancyFactory(unit=unit_a, person=resident_person)

    client_emp = api_client_for(emp_a)
    client_res = api_client_for(resident_user)
    anon = csrf_client()

    # 1) Residente recibe 403 en endpoints de invitación de empleados y residentes:
    assert client_res.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(org_a.pk), 'email': 'x@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    ).status_code == 403
    assert client_res.post(
        '/api/v1/invitations/residents',
        {'person_id': str(resident_person.pk)},
        format='json',
    ).status_code == 403

    # 2) UUID inválido en organization_id o person_id devuelve 400 (nunca 500):
    res_bad_org_uuid = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': 'not-a-uuid', 'email': 'x@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert res_bad_org_uuid.status_code == 400

    res_bad_person_uuid = client_emp.post(
        '/api/v1/invitations/residents',
        {'person_id': 'not-a-uuid'},
        format='json',
    )
    assert res_bad_person_uuid.status_code == 400

    # 3) Tipos JSON mal formados (null, int, lista) devuelven 400 (nunca 500):
    assert anon.post('/api/v1/auth/login', {'email': emp_a.email, 'password': 123}, format='json').status_code == 400
    assert anon.post('/api/v1/auth/login', {'email': None, 'password': PASSWORD}, format='json').status_code == 400
    assert anon.post('/api/v1/auth/login', ['not-a-dict'], format='json').status_code == 400
    assert anon.post('/api/v1/invitations/accept', {'token': None, 'password': PASSWORD}, format='json').status_code == 400
    assert anon.post('/api/v1/invitations/accept', {'token': 'tok', 'password': 123}, format='json').status_code == 400
    assert anon.post('/api/v1/auth/password-reset', {'email': 123}, format='json').status_code == 400
    assert anon.post(
        '/api/v1/auth/password-reset/confirm',
        {'uid': 123, 'token': 'x', 'password': PASSWORD},
        format='json',
    ).status_code == 400
    assert client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(org_a.pk), 'email': None, 'first_name': 'A', 'last_name': 'B'},
        format='json',
    ).status_code == 400
    assert client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(org_a.pk), 'email': 'ok@example.com', 'first_name': None, 'last_name': 'B'},
        format='json',
    ).status_code == 400

    # 4) Organización ajena devuelve 404 y organization_id="" devuelve 400:
    cross_res = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(org_b.pk), 'email': 'cross@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert cross_res.status_code == 404

    empty_org_res = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': '', 'email': 'empty-org@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert empty_org_res.status_code == 400
    assert not Invitation.objects.filter(email='empty-org@example.com').exists()

