from rest_framework.permissions import BasePermission

from apps.api.scoping import employee_organizations, resident_occupancies


class IsEmployee(BasePermission):
    message = 'Se requiere una membresía de empleado.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and employee_organizations(request.user).exists()
        )


class IsResident(BasePermission):
    message = 'Se requiere una ocupación accesible.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if resident_occupancies(request.user).exists():
            return True
        if getattr(view, 'kwargs', None):
            from apps.people.models import Occupancy

            return Occupancy.objects.filter(person__user=request.user).exists()
        return False
