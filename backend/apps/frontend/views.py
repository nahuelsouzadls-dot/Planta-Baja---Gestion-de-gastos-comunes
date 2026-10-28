"""Sirve la app React de `frontend/` (ADR-0018) y decide a dónde va cada sesión.

Todas las pantallas son la misma página (`index.html` del build de Vite); el ruteo fino
lo hace el front. Acá se mantiene el control de acceso: quien no corresponde a una
pantalla va a su inicio o al login antes de bajar la app.
"""
from django.conf import settings
from django.http import Http404, HttpResponse
from django.shortcuts import redirect
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_safe

from apps.api.scoping import employee_organizations, resident_occupancies

PANEL_LOGIN = '/ingresar/administracion'
PORTAL_LOGIN = '/ingresar'


def is_employee(user):
    return user.is_authenticated and employee_organizations(user).exists()


def is_resident(user):
    return user.is_authenticated and resident_occupancies(user).exists()


def home_for(user):
    if is_employee(user):
        return '/panel'
    if is_resident(user):
        return '/portal'
    return None


def _app():
    path = settings.FRONTEND_DIR / 'index.html'
    try:
        content = path.read_text(encoding='utf-8')
    except FileNotFoundError as exc:
        # Sin build del front (npm run build en frontend/).
        raise Http404('Falta compilar el front: cd frontend && npm run build') from exc
    return HttpResponse(content, content_type='text/html; charset=utf-8')


def screen(*, allowed=None, login_url=None):
    """Vista de una pantalla. `allowed(user)` decide quién la ve; el resto va a su inicio o al login."""

    @require_safe
    @never_cache
    @ensure_csrf_cookie
    def view(request, rest=''):
        if allowed is not None and not allowed(request.user):
            if not request.user.is_authenticated:
                return redirect(login_url)
            return redirect(home_for(request.user) or login_url)
        return _app()

    return view


@require_safe
@never_cache
def root(request):
    return redirect(home_for(request.user) or PORTAL_LOGIN)


panel = screen(allowed=is_employee, login_url=PANEL_LOGIN)
portal = screen(allowed=is_resident, login_url=PORTAL_LOGIN)
public = screen()
