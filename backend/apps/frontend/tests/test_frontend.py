import pytest
from django.contrib.staticfiles import finders
from django.core.management import call_command
from django.test import Client, override_settings

from apps.accounts.models import User


pytestmark = pytest.mark.django_db

APP_MARKER = '<div id="root"></div>'
PUBLIC_PAGES = ['/ingresar', '/ingresar/administracion', '/recuperar-contrasena', '/restablecer-contrasena', '/aceptar-invitacion']


@pytest.fixture(autouse=True)
def built_front(tmp_path, settings):
    """Un build de Vite mínimo: los tests no dependen de Node ni de `npm run build`."""
    dist = tmp_path / 'dist'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'index.html').write_text(
        f'<!doctype html><html lang="es"><head><script type="module" src="/static/app/assets/index-abc.js"></script></head>'
        f'<body>{APP_MARKER}</body></html>',
        encoding='utf-8',
    )
    (dist / 'assets' / 'index-abc.js').write_text('console.log("app")', encoding='utf-8')
    (dist / 'favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding='utf-8')
    settings.FRONTEND_DIR = dist
    settings.STATICFILES_DIRS = [('app', dist)]
    return dist


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')


def client_for(email):
    client = Client()
    client.force_login(User.objects.get(email=email))
    return client


@pytest.mark.parametrize('path', PUBLIC_PAGES)
def test_public_pages_serve_the_app_with_csrf_cookie(path):
    response = Client().get(path)

    assert response.status_code == 200
    assert response['Content-Type'] == 'text/html; charset=utf-8'
    assert APP_MARKER in response.content.decode()
    assert response.cookies['csrftoken'].value


@pytest.mark.parametrize('path, target', [
    ('/', '/ingresar'),
    ('/panel', '/ingresar/administracion'),
    ('/panel/edificio/123/cobros', '/ingresar/administracion'),
    ('/portal', '/ingresar'),
    ('/portal/algo', '/ingresar'),
])
def test_anonymous_goes_to_its_login(path, target):
    response = Client().get(path)

    assert response.status_code == 302
    assert response['Location'] == target


def test_employee_lands_on_panel_and_is_kept_out_of_portal(demo):
    client = client_for('maria@admin.demo')

    assert client.get('/')['Location'] == '/panel'
    for path in ('/panel', '/panel/edificio/123/gastos'):
        panel = client.get(path)
        assert panel.status_code == 200, path
        assert APP_MARKER in panel.content.decode()
        assert panel.cookies['csrftoken'].value
    assert client.get('/portal')['Location'] == '/panel'


def test_resident_lands_on_portal_and_is_kept_out_of_panel(demo):
    client = client_for('juan.perez@correo.com.uy')

    assert client.get('/')['Location'] == '/portal'
    portal = client.get('/portal')
    assert portal.status_code == 200
    assert APP_MARKER in portal.content.decode()
    assert client.get('/panel')['Location'] == '/portal'
    assert client.get('/panel/edificio/123')['Location'] == '/portal'


def test_user_without_employee_or_resident_role_goes_back_to_login(demo):
    client = Client()
    client.force_login(User.objects.create_user('nadie@example.com', 'una-clave-larga-123'))

    assert client.get('/')['Location'] == '/ingresar'
    assert client.get('/panel')['Location'] == '/ingresar/administracion'
    assert client.get('/portal')['Location'] == '/ingresar'


def test_screens_only_answer_safe_methods():
    assert Client().post('/ingresar').status_code == 405


def test_screens_are_not_cached(demo):
    response = client_for('maria@admin.demo').get('/panel')

    assert 'no-cache' in response['Cache-Control']


def test_missing_build_is_a_clear_404(built_front):
    (built_front / 'index.html').unlink()

    assert Client().get('/ingresar').status_code == 404


def test_front_build_is_found_and_collected(tmp_path):
    for name in ('index.html', 'favicon.svg', 'assets/index-abc.js'):
        assert finders.find(f'app/{name}'), name

    static_root = tmp_path / 'static'
    with override_settings(STATIC_ROOT=static_root):
        call_command('collectstatic', interactive=False, verbosity=0)

    assert (static_root / 'app' / 'assets' / 'index-abc.js').exists()
