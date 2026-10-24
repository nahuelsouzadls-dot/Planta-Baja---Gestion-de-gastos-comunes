from collections import defaultdict
from collections.abc import Mapping
import uuid

from axes.handlers.proxy import AxesProxyHandler
from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpResponse
from django.middleware.csrf import get_token
from django.urls import path
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.invitations import (
    accept_invitation,
    confirm_password_reset,
    invite_employee,
    invite_resident,
    request_password_reset,
)
from apps.api.permissions import IsEmployee
from apps.api.scoping import (
    employee_organizations,
    get_in_scope_or_404,
    resident_occupancies,
)
from apps.audit.context import audit_context
from apps.core.net import ClientIPScopedRateThrottle
from apps.people.models import Person


def error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({'detail': message}, status=code)


def _validation_message(exc):
    messages = getattr(exc, 'messages', None)
    if messages:
        return messages[0]
    return str(exc) or 'Datos inválidos'


def _parse_uuid(value):
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return uuid.UUID(value.strip())
    except (ValueError, TypeError, AttributeError):
        return None


def _login_and_rotate_session(request, user, *, backend=None):
    previous_key = request.session.session_key
    with audit_context(user):
        if backend is not None:
            login(request, user, backend=backend)
        else:
            login(request, user)
    if request.session.session_key is None or request.session.session_key == previous_key:
        request.session.cycle_key()


@extend_schema(responses=OpenApiTypes.OBJECT)
class CsrfView(APIView):
    permission_classes = [permissions.AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        get_token(request)
        return HttpResponse(status=204)


class CsrfProtectedAPIView(APIView):
    class SchemaSerializer(serializers.Serializer):
        pass

    serializer_class = SchemaSerializer

    @method_decorator(csrf_protect)
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)


@extend_schema(responses=OpenApiTypes.OBJECT)
class LoginView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ClientIPScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        if not isinstance(request.data, Mapping):
            return error('Datos inválidos')
        raw_email = request.data.get('email', '')
        password = request.data.get('password', '')
        if not isinstance(raw_email, str) or not isinstance(password, str):
            return error('Email o contraseña incorrectos')
        email = raw_email.strip().lower()
        user = authenticate(request, email=email, password=password)
        if user is None:
            if getattr(request, 'axes_locked_out', False) or AxesProxyHandler.is_locked(
                request, {'username': email}
            ):
                return error('Demasiados intentos. Probá de nuevo más tarde.', 429)
            return error('Email o contraseña incorrectos')
        _login_and_rotate_session(request, user)
        return Response({'id': str(user.pk), 'email': user.email})


@extend_schema(responses=OpenApiTypes.OBJECT)
class LogoutView(CsrfProtectedAPIView):
    def post(self, request):
        logout(request)
        return HttpResponse(status=204)


@extend_schema(responses=OpenApiTypes.OBJECT)
class MeView(APIView):
    def get(self, request):
        user = request.user
        organizations = [
            {'id': str(m.organization_id), 'name': m.organization.name}
            for m in user.org_memberships.select_related('organization')
        ]
        allowed_occupancies = list(
            resident_occupancies(user).select_related('unit__building')
        )
        occupancies_by_person = defaultdict(list)
        for occ in allowed_occupancies:
            occupancies_by_person[occ.person_id].append(occ)
        persons = []
        for person in user.people.select_related('organization'):
            persons.append({
                'id': str(person.pk),
                'organization_id': str(person.organization_id),
                'occupancies': [
                    {
                        'id': str(o.pk),
                        'unit_number': o.unit.number,
                        'building_name': o.unit.building.name,
                        'role': o.role,
                        'start_date': o.start_date,
                        'end_date': o.end_date,
                    }
                    for o in occupancies_by_person[person.pk]
                ],
            })
        return Response({
            'id': str(user.pk),
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'organizations': organizations,
            'persons': persons,
        })


@extend_schema(responses=OpenApiTypes.OBJECT)
class EmployeeInviteView(CsrfProtectedAPIView):
    permission_classes = [IsEmployee]

    def post(self, request):
        if not isinstance(request.data, Mapping):
            return error('Datos inválidos', 400)
        if 'organization_id' in request.data and request.data['organization_id'] is not None:
            org_uuid = _parse_uuid(request.data['organization_id'])
            if org_uuid is None:
                return error('Organización inválida', 400)
            organization = get_in_scope_or_404(
                employee_organizations(request.user), org_uuid
            )
        else:
            memberships = list(
                request.user.org_memberships.select_related('organization')[:2]
            )
            if len(memberships) != 1:
                return error('Organización inválida', 400)
            organization = memberships[0].organization

        email = request.data.get('email')
        first_name = request.data.get('first_name')
        last_name = request.data.get('last_name')
        if (
            not isinstance(email, str)
            or not isinstance(first_name, str)
            or not isinstance(last_name, str)
        ):
            return error('Datos inválidos', 400)
        try:
            invitation, _ = invite_employee(
                organization,
                request.user,
                email=email,
                first_name=first_name,
                last_name=last_name,
            )
        except PermissionDenied:
            return error('No autorizado', 403)
        except ValidationError as exc:
            return error(_validation_message(exc), 400)
        return Response({'id': str(invitation.pk)}, status=201)


@extend_schema(responses=OpenApiTypes.OBJECT)
class ResidentInviteView(CsrfProtectedAPIView):
    permission_classes = [IsEmployee]

    def post(self, request):
        if not isinstance(request.data, Mapping):
            return error('Datos inválidos', 400)
        person_uuid = _parse_uuid(request.data.get('person_id'))
        if person_uuid is None:
            return error('Persona inválida', 400)
        person = get_in_scope_or_404(
            Person.objects.filter(
                organization__in=employee_organizations(request.user)
            ).select_related('organization'),
            person_uuid,
        )
        try:
            invitation, _ = invite_resident(person, request.user)
        except PermissionDenied:
            return error('No autorizado', 403)
        except ValidationError as exc:
            return error(_validation_message(exc), 400)
        return Response({'id': str(invitation.pk)}, status=201)


@extend_schema(responses=OpenApiTypes.OBJECT)
class InvitationAcceptView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ClientIPScopedRateThrottle]
    throttle_scope = 'invitation_accept'

    def post(self, request):
        if not isinstance(request.data, Mapping):
            return error('Datos inválidos', 400)
        token = request.data.get('token')
        password = request.data.get('password')
        first_name = request.data.get('first_name')
        last_name = request.data.get('last_name')
        if (
            not isinstance(token, str)
            or not isinstance(password, str)
            or (first_name is not None and not isinstance(first_name, str))
            or (last_name is not None and not isinstance(last_name, str))
        ):
            return error('Datos inválidos', 400)
        try:
            user = accept_invitation(
                token,
                password,
                first_name=first_name,
                last_name=last_name,
                request=request,
            )
        except ValidationError as exc:
            if getattr(request, 'axes_locked_out', False):
                return error('Demasiados intentos. Probá de nuevo más tarde.', 429)
            return error(_validation_message(exc), 400)
        _login_and_rotate_session(
            request,
            user,
            backend='django.contrib.auth.backends.ModelBackend',
        )
        return Response({'id': str(user.pk), 'email': user.email})


@extend_schema(responses=OpenApiTypes.OBJECT)
class PasswordResetView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ClientIPScopedRateThrottle]
    throttle_scope = 'password_reset'

    def post(self, request):
        if not isinstance(request.data, Mapping):
            return error('Datos inválidos', 400)
        email = request.data.get('email', '')
        if not isinstance(email, str):
            return error('Datos inválidos', 400)
        request_password_reset(email)
        return HttpResponse(status=204)


@extend_schema(responses=OpenApiTypes.OBJECT)
class PasswordResetConfirmView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ClientIPScopedRateThrottle]
    throttle_scope = 'password_reset_confirm'

    def post(self, request):
        if not isinstance(request.data, Mapping):
            return error('Datos inválidos', 400)
        uid = request.data.get('uid')
        token = request.data.get('token')
        password = request.data.get('password')
        if (
            not isinstance(uid, str)
            or not isinstance(token, str)
            or not isinstance(password, str)
        ):
            return error('Datos inválidos', 400)
        try:
            confirm_password_reset(uid, token, password)
        except ValidationError as exc:
            return error(_validation_message(exc), 400)
        if request.session.session_key:
            request.session.cycle_key()
        return HttpResponse(status=204)


urlpatterns = [
    path('auth/csrf', CsrfView.as_view()),
    path('auth/login', LoginView.as_view()),
    path('auth/logout', LogoutView.as_view()),
    path('auth/me', MeView.as_view()),
    path('invitations/employees', EmployeeInviteView.as_view()),
    path('invitations/residents', ResidentInviteView.as_view()),
    path('invitations/accept', InvitationAcceptView.as_view()),
    path('auth/password-reset', PasswordResetView.as_view()),
    path('auth/password-reset/confirm', PasswordResetConfirmView.as_view()),
]
