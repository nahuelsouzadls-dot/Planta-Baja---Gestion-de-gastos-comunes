from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpResponse
from django.middleware.csrf import get_token
from django.urls import path
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.invitations import (
    accept_invitation, confirm_password_reset, invite_employee,
    invite_resident, request_password_reset,
)
from apps.accounts.models import OrgMembership
from apps.people.models import Person


def error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({'detail': message}, status=code)


class CsrfView(APIView):
    permission_classes = [permissions.AllowAny]

    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        get_token(request)
        return HttpResponse(status=204)


class CsrfProtectedAPIView(APIView):
    @method_decorator(csrf_protect)
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)


class LoginView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        email = str(request.data.get('email', '')).strip().lower()
        password = request.data.get('password', '')
        user = authenticate(request, email=email, password=password)
        if user is None:
            from axes.handlers.proxy import AxesProxyHandler
            if AxesProxyHandler.is_locked(request, {'username': email}):
                return error('Demasiados intentos. Probá de nuevo más tarde.', 429)
            return error('Email o contraseña incorrectos')
        login(request, user)
        return Response({'id': str(user.pk), 'email': user.email})


class LogoutView(CsrfProtectedAPIView):
    def post(self, request):
        logout(request)
        return HttpResponse(status=204)


class MeView(APIView):
    def get(self, request):
        user = request.user
        organizations = [
            {'id': str(m.organization_id), 'name': m.organization.name}
            for m in user.org_memberships.select_related('organization')
        ]
        persons = []
        for person in user.people.select_related('organization').prefetch_related(
            'occupancies__unit__building'
        ):
            persons.append({
                'id': str(person.pk), 'organization_id': str(person.organization_id),
                'occupancies': [{
                    'id': str(o.pk), 'unit_number': o.unit.number,
                    'building_name': o.unit.building.name, 'role': o.role,
                    'start_date': o.start_date, 'end_date': o.end_date,
                } for o in person.occupancies.all()],
            })
        return Response({
            'id': str(user.pk), 'email': user.email, 'first_name': user.first_name,
            'last_name': user.last_name, 'organizations': organizations,
            'persons': persons,
        })


class EmployeeInviteView(CsrfProtectedAPIView):
    def post(self, request):
        organization_id = request.data.get('organization_id')
        memberships = request.user.org_memberships.select_related('organization')
        if organization_id:
            memberships = memberships.filter(organization_id=organization_id)
        membership = memberships.first() if memberships.count() == 1 else None
        if not membership:
            return error('Organización inválida', 400)
        try:
            invitation, _ = invite_employee(
                membership.organization, request.user,
                email=request.data['email'], first_name=request.data['first_name'],
                last_name=request.data['last_name'],
            )
        except PermissionDenied:
            return error('No autorizado', 403)
        except (KeyError, ValidationError) as exc:
            return error(str(exc) or 'Datos inválidos')
        return Response({'id': str(invitation.pk)}, status=201)


class ResidentInviteView(CsrfProtectedAPIView):
    def post(self, request):
        person = Person.objects.filter(
            pk=request.data.get('person_id'),
            organization__memberships__user=request.user,
        ).first()
        if person is None:
            return error('No encontrado', 404)
        try:
            invitation, _ = invite_resident(person, request.user)
        except PermissionDenied:
            return error('No autorizado', 403)
        except ValidationError as exc:
            return error(str(exc))
        return Response({'id': str(invitation.pk)}, status=201)


class InvitationAcceptView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'invitation_accept'

    def post(self, request):
        try:
            user = accept_invitation(
                request.data['token'], request.data['password'],
                first_name=request.data.get('first_name'),
                last_name=request.data.get('last_name'),
            )
        except (KeyError, ValidationError) as exc:
            return error(str(exc))
        login(request, user, backend='django.contrib.auth.backends.ModelBackend')
        return Response({'id': str(user.pk), 'email': user.email})


class PasswordResetView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset'

    def post(self, request):
        request_password_reset(request.data.get('email', ''))
        return HttpResponse(status=204)


class PasswordResetConfirmView(CsrfProtectedAPIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset'

    def post(self, request):
        try:
            confirm_password_reset(
                request.data['uid'], request.data['token'], request.data['password']
            )
        except (KeyError, ValidationError) as exc:
            return error(str(exc))
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
