import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.contrib.sessions.models import Session
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import IntegrityError, models, transaction
from django.http import HttpRequest
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from apps.accounts.models import Invitation, OrgMembership
from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.people.models import Person

User = get_user_model()
INVALID_INVITATION = 'El link no es válido o venció'


def _hash(token):
    if not isinstance(token, str) or not token.strip():
        raise ValidationError(INVALID_INVITATION)
    return hashlib.sha256(token.encode()).hexdigest()


def _link(token):
    return f'{settings.FRONTEND_BASE_URL}/aceptar-invitacion?token={token}'


def _assert_member(user, organization):
    if not user.is_authenticated or not OrgMembership.objects.filter(
        user=user, organization=organization
    ).exists():
        raise PermissionDenied('No pertenecés a esta organización.')


def _send_invitation(invitation, token):
    send_mail(
        'Invitación a Administración GC',
        f'Completá tu registro en {_link(token)}',
        settings.DEFAULT_FROM_EMAIL,
        [invitation.email],
    )


def send_password_reset_email(email, uid, token):
    """Envía el enlace de recuperación de contraseña.

    Se agenda mediante transaction.on_commit(lambda: send_password_reset_email(...))
    para desacoplar el envío de la transacción de base de datos; en D2 pasa a
    ejecutarse como tarea asíncrona de Celery para que el servidor SMTP nunca
    agregue latencia observable al request HTTP.
    """
    send_mail(
        'Recuperación de contraseña',
        f'{settings.FRONTEND_BASE_URL}/restablecer-contrasena?uid={uid}&token={token}',
        settings.DEFAULT_FROM_EMAIL,
        [email],
    )


def _create_invitation(organization, user, *, kind, email, person=None,
                       first_name='', last_name=''):
    now = timezone.now()
    token = secrets.token_urlsafe(32)
    with transaction.atomic():
        _assert_member(user, organization)
        with audit_context(user, organization=organization):
            if kind == Invitation.Kind.EMPLOYEE and User.objects.filter(
                email=email
            ).filter(org_memberships__organization=organization).exists():
                raise ValidationError('Ya existe un empleado con ese email.')
            revoke_filter = models.Q(organization=organization, email=email)
            if person is not None:
                revoke_filter |= models.Q(person=person)
            Invitation.objects.filter(
                revoke_filter,
                used_at__isnull=True,
                revoked_at__isnull=True,
            ).update(revoked_at=now)
            invitation = Invitation.objects.create(
                organization=organization, kind=kind, person=person,
                email=email, first_name=first_name, last_name=last_name,
                token_hash=_hash(token), expires_at=now + timedelta(hours=72),
                created_by=user,
            )
            record_event(
                user, organization, 'invitation.create', invitation,
                'Creó una invitación', kind=kind,
            )
            transaction.on_commit(lambda: _send_invitation(invitation, token))
    return invitation, token


def invite_employee(organization, user, *, email, first_name, last_name):
    if (
        not isinstance(email, str)
        or not isinstance(first_name, str)
        or not isinstance(last_name, str)
    ):
        raise ValidationError('Datos inválidos.')
    email = email.strip().lower()
    first_name = first_name.strip()
    last_name = last_name.strip()
    if not first_name or not last_name:
        raise ValidationError('Nombre y apellido son obligatorios.')
    validate_email(email)
    return _create_invitation(
        organization, user, kind=Invitation.Kind.EMPLOYEE, email=email,
        first_name=first_name, last_name=last_name,
    )


def invite_resident(person, user):
    email = (person.email or '').strip().lower()
    if not email:
        raise ValidationError('La persona no tiene email.')
    validate_email(email)
    if person.user_id:
        raise ValidationError('La persona ya tiene una cuenta.')
    return _create_invitation(
        person.organization, user, kind=Invitation.Kind.RESIDENT,
        email=email, person=person,
        first_name=person.first_name, last_name=person.last_name,
    )


def _ensure_request(request):
    if request is not None:
        return request
    fallback = HttpRequest()
    fallback.method = 'POST'
    fallback.path = '/api/v1/invitations/accept'
    fallback.META['REMOTE_ADDR'] = '127.0.0.1'
    return fallback


def accept_invitation(token, password, *, first_name=None, last_name=None, request=None):
    if not isinstance(token, str) or not token.strip() or not isinstance(password, str) or password == '':
        raise ValidationError(INVALID_INVITATION)
    if (first_name is not None and not isinstance(first_name, str)) or (
        last_name is not None and not isinstance(last_name, str)
    ):
        raise ValidationError('Datos inválidos.')

    now = timezone.now()
    token_hash = _hash(token)
    auth_request = _ensure_request(request)
    auth_failed = False

    with transaction.atomic():
        invitation = Invitation.objects.select_for_update().filter(
            token_hash=token_hash
        ).first()
        person = None
        invalid_invitation = (
            invitation is None
            or invitation.used_at is not None
            or invitation.revoked_at is not None
            or invitation.expires_at <= now
        )
        if not invalid_invitation and invitation.kind == Invitation.Kind.RESIDENT:
            person = Person.objects.select_for_update().filter(
                pk=invitation.person_id
            ).first()
            person_email = (person.email or '').strip().lower() if person else ''
            invitation_email = (invitation.email or '').strip().lower()
            if (
                person is None
                or not person_email
                or person_email != invitation_email
                or person.organization_id != invitation.organization_id
            ):
                invalid_invitation = True

        if invalid_invitation:
            User().set_password(password)
            raise ValidationError(INVALID_INVITATION)

        user = User.objects.select_for_update().filter(email=invitation.email).first()
        if user is not None:
            if (
                invitation.kind == Invitation.Kind.RESIDENT
                and person.user_id
                and person.user_id != user.pk
            ):
                User().set_password(password)
                raise ValidationError(INVALID_INVITATION)
            authenticated = authenticate(
                request=auth_request,
                email=user.email,
                password=password,
            )
            if authenticated is None or not user.is_active:
                auth_failed = True
        else:
            if invitation.kind == Invitation.Kind.RESIDENT and person.user_id is not None:
                User().set_password(password)
                raise ValidationError(INVALID_INVITATION)
            candidate = User(
                email=User.objects._normalize_email(invitation.email),
                first_name=(first_name or invitation.first_name or '').strip(),
                last_name=(last_name or invitation.last_name or '').strip(),
            )
            validate_password(password, candidate)
            candidate.set_password(password)
            user = candidate
            with audit_context(user, organization=invitation.organization):
                try:
                    user.save(using=User.objects._db)
                except IntegrityError as exc:
                    raise ValidationError(INVALID_INVITATION) from exc

        if not auth_failed:
            with audit_context(user, organization=invitation.organization):
                if invitation.kind == Invitation.Kind.EMPLOYEE:
                    OrgMembership.objects.get_or_create(
                        user=user, organization=invitation.organization
                    )
                else:
                    person.user = user
                    person.save(update_fields=['user', 'updated_at'])
                invitation.used_at = now
                invitation.save(update_fields=['used_at', 'updated_at'])
                record_event(
                    user, invitation.organization, 'invitation.accept',
                    invitation, 'Aceptó una invitación',
                )

    if auth_failed:
        raise ValidationError(INVALID_INVITATION)
    return user


def request_password_reset(email):
    if not isinstance(email, str):
        raise ValidationError('El email no es válido.')
    normalized = email.strip().lower()
    user = User.objects.filter(email=normalized, is_active=True).first()
    if user is None:
        PasswordResetTokenGenerator().make_token(
            User(email=normalized or 'invalid@example.com', password='!')
        )
        return
    token = PasswordResetTokenGenerator().make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    target_email = user.email
    transaction.on_commit(
        lambda: send_password_reset_email(target_email, uid, token)
    )


def _invalidate_user_sessions(user, *, exclude_session_key=None):
    stale_keys = []
    for session in Session.objects.filter(expire_date__gt=timezone.now()):
        if str(session.get_decoded().get('_auth_user_id')) == str(user.pk):
            if exclude_session_key and session.session_key == exclude_session_key:
                continue
            stale_keys.append(session.session_key)
    if stale_keys:
        Session.objects.filter(session_key__in=stale_keys).delete()


def confirm_password_reset(uid, token, password, *, exclude_session_key=None):
    if (
        not isinstance(uid, str)
        or not uid.strip()
        or not isinstance(token, str)
        or not token.strip()
        or not isinstance(password, str)
        or password == ''
    ):
        raise ValidationError(INVALID_INVITATION)
    with transaction.atomic():
        try:
            user_id = urlsafe_base64_decode(uid).decode()
            user = User.objects.select_for_update().get(pk=user_id, is_active=True)
        except (
            ValueError,
            TypeError,
            OverflowError,
            UnicodeDecodeError,
            ValidationError,
            User.DoesNotExist,
        ) as exc:
            raise ValidationError(INVALID_INVITATION) from exc
        generator = PasswordResetTokenGenerator()
        if not generator.check_token(user, token):
            raise ValidationError(INVALID_INVITATION)
        validate_password(password, user)
        with audit_context(user):
            user.set_password(password)
            user.save(update_fields=['password'])
        _invalidate_user_sessions(user, exclude_session_key=exclude_session_key)
    return user
