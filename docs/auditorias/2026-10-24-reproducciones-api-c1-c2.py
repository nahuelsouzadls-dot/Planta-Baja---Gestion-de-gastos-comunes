from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from apps.accounts.invitations import (
    accept_invitation,
    confirm_password_reset,
    invite_employee,
    invite_resident,
)
from apps.accounts.models import Invitation, Organization, OrgMembership, User
from apps.api.scoping import resident_buildings, resident_occupancies
from apps.api.testing import api_client_for
from apps.audit.models import RowChange
from apps.buildings.models import Building, Unit
from apps.ledger.models import LedgerEntry
from apps.people.models import Occupancy, Person
from apps.people.services import update_person


PASSWORD = 'Correct horse battery staple 123'


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _csrf_client():
    client = APIClient(enforce_csrf_checks=True)
    res = client.get('/api/v1/auth/csrf')
    assert res.status_code == 204
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    return client


@pytest.mark.django_db
def test_1_resident_invitation_accepts_stale_email_and_hijacks_person():
    org = Organization.objects.create(name='Confort S.A.')
    admin = User.objects.create_user('admin@confort.com', PASSWORD)
    OrgMembership.objects.create(user=admin, organization=org)

    person = Person.objects.create(
        organization=org,
        first_name='Lucía',
        last_name='Gómez',
        email='equivocado@example.com',
    )
    inv_old, token_old = invite_resident(person, admin)

    # La administración corrige el email de la persona antes de que acepte
    # y reenvía la invitación al email correcto.
    person = update_person(person, admin, email='lucia.real@example.com')
    inv_new, token_new = invite_resident(person, admin)

    inv_old.refresh_from_db()
    # La invitación vieja NO fue revocada porque _create_invitation filtra por email y no por person.
    assert inv_old.revoked_at is None

    # El tercero con el token viejo acepta la invitación y queda vinculado a la Person de Lucía.
    attacker_user = accept_invitation(token_old, PASSWORD)
    person.refresh_from_db()
    assert person.email == 'lucia.real@example.com'
    assert attacker_user.email == 'equivocado@example.com'
    assert person.user_id == attacker_user.pk

    # Ahora la verdadera Lucía no puede usar su invitación vigente.
    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        accept_invitation(token_new, PASSWORD)


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
def test_2_throttle_bypass_via_x_forwarded_for_and_axes_shared_proxy_ip():
    client = _csrf_client()
    # PasswordResetView tiene un límite de 5/hour, pero cambiando X-Forwarded-For
    # (incluso con la IP del proxy de Railway agregada al final) nunca devuelve 429.
    for i in range(12):
        res = client.post(
            '/api/v1/auth/password-reset',
            {'email': f'user{i}@example.com'},
            format='json',
            REMOTE_ADDR='10.0.0.1',
            HTTP_X_FORWARDED_FOR=f'203.0.113.{i}, 198.51.100.77',
        )
        assert res.status_code == 204

    # En LoginView (10/min), un atacante detrás del mismo proxy (REMOTE_ADDR='10.0.0.2')
    # evade el throttle de 10/min con X-Forwarded-For y además bloquea la cuenta de la víctima
    # para el usuario legítimo que entra por el mismo proxy.
    victim = User.objects.create_user('victim@example.com', PASSWORD)
    for i in range(15):
        res = client.post(
            '/api/v1/auth/login',
            {'email': f'probe-{i}@example.com', 'password': 'wrong-password'},
            format='json',
            REMOTE_ADDR='10.0.0.2',
            HTTP_X_FORWARDED_FOR=f'192.0.2.{i}',
        )
        assert res.status_code == 400

    for i in range(5):
        client.post(
            '/api/v1/auth/login',
            {'email': victim.email, 'password': 'wrong-password'},
            format='json',
            REMOTE_ADDR='10.0.0.2',
            HTTP_X_FORWARDED_FOR=f'198.18.0.{i}',
        )

    # El usuario legítimo entra con la contraseña correcta pero comparte REMOTE_ADDR del proxy:
    legit_res = client.post(
        '/api/v1/auth/login',
        {'email': victim.email, 'password': PASSWORD},
        format='json',
        REMOTE_ADDR='10.0.0.2',
        HTTP_X_FORWARDED_FOR='198.51.100.200',
    )
    assert legit_res.status_code == 429


@pytest.mark.django_db
def test_3_invitation_accept_bypasses_axes_allows_inactive_user_and_skips_similarity_validator():
    org = Organization.objects.create(name='Org')
    admin = User.objects.create_user('admin@org.com', PASSWORD)
    OrgMembership.objects.create(user=admin, organization=org)

    # 1) Usuario existente pero desactivado (is_active=False):
    inactive_user = User.objects.create_user(
        'inactive@example.com', PASSWORD, is_active=False
    )
    _, token_existing = invite_employee(
        org, admin, email=inactive_user.email, first_name='In', last_name='Activo'
    )

    client = _csrf_client()
    # 8 intentos fallidos contra la invitación NO bloquean al usuario en axes ni consumen el token:
    for i in range(8):
        res = client.post(
            '/api/v1/invitations/accept',
            {'token': token_existing, 'password': f'WrongPassword-{i}-12345'},
            format='json',
            REMOTE_ADDR='10.99.0.1',
            HTTP_X_FORWARDED_FOR=f'203.0.113.{i}',
        )
        assert res.status_code == 400

    # Al acertar la contraseña, accept_invitation vincula al usuario inactivo y login()
    # devuelve 200 OK pese a que is_active es False.
    ok_res = client.post(
        '/api/v1/invitations/accept',
        {'token': token_existing, 'password': PASSWORD},
        format='json',
        REMOTE_ADDR='10.99.0.1',
        HTTP_X_FORWARDED_FOR='203.0.113.99',
    )
    assert ok_res.status_code == 200
    assert OrgMembership.objects.filter(user=inactive_user, organization=org).exists()

    # 2) Para un usuario nuevo, validate_password(password) se llama sin user,
    # permitiendo usar el propio email como contraseña:
    _, token_new = invite_employee(
        org, admin, email='similar-user@example.com', first_name='Similar', last_name='User'
    )
    accepted_new = accept_invitation(token_new, 'similar-user@example.com')
    assert accepted_new.check_password('similar-user@example.com')


@pytest.mark.django_db
def test_4_me_view_and_resident_buildings_violate_ex_tenant_rule_n17():
    org = Organization.objects.create(name='Org N17')
    building = Building.objects.create(organization=org, name='Edificio Sur', address='Sur 1')
    unit = Unit.objects.create(
        building=building, number='202', floor=2, coefficient=Decimal('1.000000')
    )

    # Ex inquilino con saldo 0 (ya saldó su deuda):
    settled_user = User.objects.create_user('settled@example.com', PASSWORD)
    settled_person = Person.objects.create(
        organization=org, first_name='Ex', last_name='Saldado', user=settled_user
    )
    settled_occ = Occupancy.objects.create(
        unit=unit,
        person=settled_person,
        role=Occupancy.Role.TENANT,
        start_date=date.today() - timedelta(days=120),
        end_date=date.today() - timedelta(days=30),
    )

    client = api_client_for(settled_user)
    # En /api/v1/portal/occupancies recibe 403 porque resident_occupancies está vacío:
    assert client.get('/api/v1/portal/occupancies').status_code == 403
    assert list(resident_occupancies(settled_user)) == []

    # Pero en /api/v1/auth/me sigue viendo la ocupación cerrada y saldada:
    me_res = client.get('/api/v1/auth/me')
    assert me_res.status_code == 200
    assert len(me_res.json()['persons'][0]['occupancies']) == 1
    assert me_res.json()['persons'][0]['occupancies'][0]['id'] == str(settled_occ.pk)

    # Y para un ex inquilino moroso (cerrado con saldo > 0), resident_buildings devuelve el edificio:
    debtor_user = User.objects.create_user('debtor@example.com', PASSWORD)
    debtor_person = Person.objects.create(
        organization=org, first_name='Ex', last_name='Deudor', user=debtor_user
    )
    debtor_occ = Occupancy.objects.create(
        unit=unit,
        person=debtor_person,
        role=Occupancy.Role.TENANT,
        start_date=date.today() - timedelta(days=240),
        end_date=date.today() - timedelta(days=130),
    )
    LedgerEntry.objects.create(
        occupancy=debtor_occ,
        date=date.today() - timedelta(days=140),
        kind='opening',
        amount=Decimal('500.00'),
        created_by=debtor_user,
    )
    assert list(resident_buildings(debtor_user)) == [building]


@pytest.mark.django_db
def test_5_session_key_not_rotated_for_logged_in_user_and_audit_actor_contaminated_or_null():
    org = Organization.objects.create(name='Org Audit')
    user_a = User.objects.create_user('user_a@example.com', PASSWORD)
    OrgMembership.objects.create(user=user_a, organization=org)

    client = _csrf_client()
    res1 = client.post(
        '/api/v1/auth/login',
        {'email': user_a.email, 'password': PASSWORD},
        format='json',
    )
    assert res1.status_code == 200
    session_before = client.cookies['sessionid'].value

    # El UPDATE de last_login en accounts_user quedó con actor=None en audit_rowchange:
    login_change = RowChange.objects.filter(
        table_name='accounts_user',
        row_id=user_a.pk,
        operation=RowChange.Operation.UPDATE,
    ).latest('created_at')
    assert login_change.actor is None

    # Si el mismo usuario vuelve a hacer login o acepta una invitación para su cuenta,
    # el sessionid NO cambia:
    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    res2 = client.post(
        '/api/v1/auth/login',
        {'email': user_a.email, 'password': PASSWORD},
        format='json',
    )
    assert res2.status_code == 200
    assert client.cookies['sessionid'].value == session_before

    # Si en el mismo navegador (con sesión de user_a) otro usuario nuevo user_b acepta una invitación,
    # el INSERT de user_b en accounts_user queda atribuido a user_a (y el UPDATE de last_login también):
    _, token_b = invite_employee(
        org, user_a, email='user_b@example.com', first_name='User', last_name='B'
    )
    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    res_accept = client.post(
        '/api/v1/invitations/accept',
        {'token': token_b, 'password': PASSWORD},
        format='json',
    )
    assert res_accept.status_code == 200
    user_b = User.objects.get(email='user_b@example.com')
    insert_b = RowChange.objects.get(
        table_name='accounts_user',
        row_id=user_b.pk,
        operation=RowChange.Operation.INSERT,
    )
    assert insert_b.actor == user_a
    assert insert_b.organization_id is None


@pytest.mark.django_db
def test_6_password_reset_sync_email_timing_inactive_user_and_uuid_error_leak(monkeypatch):
    active_user = User.objects.create_user('active-reset@example.com', PASSWORD)
    inactive_user = User.objects.create_user(
        'inactive-reset@example.com', PASSWORD, is_active=False
    )

    # 1) confirm_password_reset permite cambiar la contraseña de un usuario con is_active=False
    # y deja actor=None en audit_rowchange:
    from django.contrib.auth.tokens import PasswordResetTokenGenerator
    token = PasswordResetTokenGenerator().make_token(inactive_user)
    uid = urlsafe_base64_encode(force_bytes(inactive_user.pk))
    confirm_password_reset(uid, token, 'NewValidPassword123!')
    inactive_user.refresh_from_db()
    assert inactive_user.check_password('NewValidPassword123!')
    pw_change = RowChange.objects.filter(
        table_name='accounts_user',
        row_id=inactive_user.pk,
        operation=RowChange.Operation.UPDATE,
    ).latest('created_at')
    assert pw_change.actor is None

    # 2) uid base64 que decodifica a un string no-UUID filtra ValidationError de UUIDField:
    client = _csrf_client()
    bad_uid = urlsafe_base64_encode(b'123')
    res_bad_uid = client.post(
        '/api/v1/auth/password-reset/confirm',
        {'uid': bad_uid, 'token': 'any-token', 'password': 'NewValidPassword123!'},
        format='json',
    )
    assert res_bad_uid.status_code == 400
    assert 'UUID' in res_bad_uid.json()['detail']

    # 3) En un request POST real (envuelto en AuditContextMiddleware -> transaction.atomic()),
    # el on_commit de send_mail corre sincrónicamente antes de responder solo si el email existe:
    calls = []
    monkeypatch.setattr(
        'apps.accounts.invitations.send_mail',
        lambda *args, **kwargs: calls.append(args),
    )
    with TestCase.captureOnCommitCallbacks(execute=True):
        client.post('/api/v1/auth/password-reset', {'email': 'absent@example.com'}, format='json')
    assert len(calls) == 0
    with TestCase.captureOnCommitCallbacks(execute=True):
        client.post('/api/v1/auth/password-reset', {'email': active_user.email}, format='json')
    assert len(calls) == 1


@pytest.mark.django_db
def test_7_unhandled_500_on_malformed_inputs_and_status_code_mismatches():
    org_a = Organization.objects.create(name='Org A')
    org_b = Organization.objects.create(name='Org B')
    emp_a = User.objects.create_user('emp_a@example.com', PASSWORD)
    OrgMembership.objects.create(user=emp_a, organization=org_a)

    client_emp = api_client_for(emp_a)

    # 1) UUID inválido en organization_id o person_id provoca ValidationError no capturado:
    with pytest.raises(ValidationError):
        client_emp.post(
            '/api/v1/invitations/employees',
            {'organization_id': 'not-a-uuid', 'email': 'x@example.com', 'first_name': 'A', 'last_name': 'B'},
            format='json',
        )
    with pytest.raises(ValidationError):
        client_emp.post(
            '/api/v1/invitations/residents',
            {'person_id': 'not-a-uuid'},
            format='json',
        )

    # 2) Tipos JSON no string (null/int) lanzan AttributeError no capturados (500):
    anon = _csrf_client()
    with pytest.raises(AttributeError):
        anon.post('/api/v1/auth/login', {'email': emp_a.email, 'password': 123}, format='json')
    with pytest.raises(AttributeError):
        anon.post('/api/v1/invitations/accept', {'token': None, 'password': PASSWORD}, format='json')
    with pytest.raises(AttributeError):
        anon.post('/api/v1/auth/password-reset/confirm', {'uid': 123, 'token': 'x', 'password': PASSWORD}, format='json')

    # 3) Organización ajena en EmployeeInviteView devuelve 400 en vez de 404,
    # y organization_id="" (string vacío) es ignorado e invita en org_a:
    cross_res = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(org_b.pk), 'email': 'cross@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert cross_res.status_code == 400

    empty_org_res = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': '', 'email': 'empty-org@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert empty_org_res.status_code == 201
    assert Invitation.objects.filter(email='empty-org@example.com', organization=org_a).exists()
