import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.http import urlsafe_base64_decode

from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.accounts.models import Invitation, OrgMembership
from apps.people.models import Person

User = get_user_model()
INVALID_INVITATION = 'El link no es válido o venció'


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _link(token):
    return f'{settings.FRONTEND_BASE_URL}/aceptar-invitacion?token={token}'


def _assert_member(user, organization):
    if not user.is_authenticated or not OrgMembership.objects.filter(
        user=user, organization=organization
    ).exists():
        from django.core.exceptions import PermissionDenied
        raise PermissionDenied('No pertenecés a esta organización.')


def _send_invitation(invitation, token):
    send_mail(
        'Invitación a Administración GC',
        f'Completá tu registro en {_link(token)}',
        settings.DEFAULT_FROM_EMAIL,
        [invitation.email],
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
            Invitation.objects.filter(
                organization=organization, email=email,
                used_at__isnull=True, revoked_at__isnull=True,
                expires_at__gt=now,
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
    email = email.strip().lower()
    validate_email(email)
    return _create_invitation(
        organization, user, kind=Invitation.Kind.EMPLOYEE, email=email,
        first_name=first_name, last_name=last_name,
    )


def invite_resident(person, user):
    if not person.email:
        raise ValidationError('La persona no tiene email.')
    if person.user_id:
        raise ValidationError('La persona ya tiene una cuenta.')
    return _create_invitation(
        person.organization, user, kind=Invitation.Kind.RESIDENT,
        email=person.email, person=person,
    )


def accept_invitation(token, password, *, first_name=None, last_name=None):
    now = timezone.now()
    with transaction.atomic():
        invitation = Invitation.objects.select_for_update().filter(
            token_hash=_hash(token)
        ).first()
        if (
            invitation is None or invitation.used_at is not None
            or invitation.revoked_at is not None or invitation.expires_at <= now
        ):
            raise ValidationError(INVALID_INVITATION)
        try:
            validate_password(password)
        except ValidationError:
            raise
        user = User.objects.filter(email=invitation.email).first()
        if user is None:
            user = User.objects.create_user(
                invitation.email, password=password,
                first_name=first_name or invitation.first_name,
                last_name=last_name or invitation.last_name,
            )
        elif not user.check_password(password):
            raise ValidationError(INVALID_INVITATION)
        with audit_context(user, organization=invitation.organization):
            if invitation.kind == Invitation.Kind.EMPLOYEE:
                OrgMembership.objects.get_or_create(
                    user=user, organization=invitation.organization
                )
            else:
                person = Person.objects.select_for_update().get(
                    pk=invitation.person_id
                )
                if person.user_id and person.user_id != user.pk:
                    raise ValidationError(INVALID_INVITATION)
                person.user = user
                person.save(update_fields=['user', 'updated_at'])
            invitation.used_at = now
            invitation.save(update_fields=['used_at', 'updated_at'])
            record_event(
                user, invitation.organization, 'invitation.accept',
                invitation, 'Aceptó una invitación',
            )
    return user


def request_password_reset(email):
    normalized = (email or '').strip().lower()
    user = User.objects.filter(email=normalized, is_active=True).first()
    if user:
        token = PasswordResetTokenGenerator().make_token(user)
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        transaction.on_commit(lambda: send_mail(
            'Recuperación de contraseña',
            f'{settings.FRONTEND_BASE_URL}/restablecer-contrasena?uid={uid}&token={token}',
            settings.DEFAULT_FROM_EMAIL, [user.email],
        ))


def confirm_password_reset(uid, token, password):
    try:
        user_id = urlsafe_base64_decode(uid).decode()
        user = User.objects.get(pk=user_id)
    except (ValueError, TypeError, OverflowError, User.DoesNotExist):
        raise ValidationError('El link no es válido o venció')
    generator = PasswordResetTokenGenerator()
    if not generator.check_token(user, token):
        raise ValidationError('El link no es válido o venció')
    validate_password(password, user)
    user.set_password(password)
    user.save(update_fields=['password'])
    return user
