# Adaptador de verificación (fuera del repo): las reproducciones de agy usan las firmas
# anteriores a SEC2; acá se completa el usuario con un empleado de la organización, sin
# cambiar lo que cada reproducción intenta.
import pytest
from datetime import date
from django.contrib.auth import get_user_model
from apps.accounts.models import OrgMembership
import apps.buildings.services as bs, apps.settlements.services as ss, apps.people.services as ps

def _member(org):
    U = get_user_model()
    u, _ = U.objects.get_or_create(email=f'verif-{org.pk}@test.local')
    OrgMembership.objects.get_or_create(user=u, organization=org)
    return u

@pytest.fixture(autouse=True)
def _adapt(request):
    m = request.module
    def create_building(org, *a, **kw):
        if a and not isinstance(a[0], str): return bs.create_building(org, *a, **kw)
        return bs.create_building(org, _member(org), **kw)
    def save_draft(building, *a, **kw):
        if a and isinstance(a[0], date): return ss.save_draft(building, _member(building.organization), *a, **kw)
        return ss.save_draft(building, *a, **kw)
    def delete_draft(s, *a):
        return ss.delete_draft(s, *a) if a else ss.delete_draft(s, _member(s.building.organization))
    def create_person(org, *a, **kw):
        return ps.create_person(org, *a, **kw) if a else ps.create_person(org, _member(org), **kw)
    for name, fn in [('create_building', create_building), ('save_draft', save_draft), ('delete_draft', delete_draft), ('create_person', create_person)]:
        if hasattr(m, name): setattr(m, name, fn)
    yield
