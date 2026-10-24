import pytest
from django.contrib.staticfiles import finders
from django.core.management import call_command
from django.test import Client, override_settings

from apps.accounts.models import User


pytestmark = pytest.mark.django_db

LOGIN_PAGES = {
    '/ingresar': 'data-home="/portal"',
    '/ingresar/administracion': 'data-home="/panel"',
    '/recuperar-contrasena': 'data-form="reset-request"',
    '/restablecer-contrasena': 'data-form="reset-confirm"',
    '/aceptar-invitacion': 'data-form="accept"',
}


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')


def client_for(email):
    client = Client()
    client.force_login(User.objects.get(email=email))
    return client


@pytest.mark.parametrize('path, marker', LOGIN_PAGES.items())
def test_public_pages_serve_html_with_csrf_cookie(path, marker):
    response = Client().get(path)

    assert response.status_code == 200
    assert response['Content-Type'] == 'text/html; charset=utf-8'
    assert marker in response.content.decode()
    assert '/static/assets/login.js' in response.content.decode()
    assert response.cookies['csrftoken'].value


@pytest.mark.parametrize('path, target', [
    ('/', '/ingresar'),
    ('/panel', '/ingresar/administracion'),
    ('/portal', '/ingresar'),
])
def test_anonymous_goes_to_its_login(path, target):
    response = Client().get(path)

    assert response.status_code == 302
    assert response['Location'] == target


def test_employee_lands_on_panel_and_is_kept_out_of_portal(demo):
    client = client_for('maria@confort.demo')

    assert client.get('/')['Location'] == '/panel'
    panel = client.get('/panel')
    assert panel.status_code == 200
    assert '/static/assets/admin.js' in panel.content.decode()
    assert 'ledger.js' not in panel.content.decode()
    assert panel.cookies['csrftoken'].value
    assert client.get('/portal')['Location'] == '/panel'


def test_resident_lands_on_portal_and_is_kept_out_of_panel(demo):
    client = client_for('juan.perez@correo.com.uy')

    assert client.get('/')['Location'] == '/portal'
    portal = client.get('/portal')
    assert portal.status_code == 200
    assert '/static/assets/portal.js' in portal.content.decode()
    assert 'ledger.js' not in portal.content.decode()
    assert client.get('/panel')['Location'] == '/portal'


def test_user_without_employee_or_resident_role_goes_back_to_login(demo):
    client = Client()
    client.force_login(User.objects.create_user('nadie@example.com', 'una-clave-larga-123'))

    assert client.get('/')['Location'] == '/ingresar'
    assert client.get('/panel')['Location'] == '/ingresar/administracion'
    assert client.get('/portal')['Location'] == '/ingresar'


def test_screens_only_answer_safe_methods():
    assert Client().post('/ingresar').status_code == 405


def test_screens_are_not_cached(demo):
    response = client_for('maria@confort.demo').get('/panel')

    assert 'no-cache' in response['Cache-Control']


def test_front_assets_are_found_and_collected(tmp_path):
    for name in ('admin.css', 'portal.css', 'api.js', 'login.js', 'admin.js', 'portal.js', 'foto-fondo.jpg'):
        assert finders.find(f'assets/{name}'), name

    with override_settings(STATIC_ROOT=tmp_path):
        call_command('collectstatic', interactive=False, verbosity=0)

    assert (tmp_path / 'assets' / 'admin.css').exists()
    assert (tmp_path / 'assets' / 'api.js').exists()
