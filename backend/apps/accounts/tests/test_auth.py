import pytest
from django.contrib.auth import authenticate
from django.urls import reverse

from apps.accounts.models import User


@pytest.mark.django_db
def test_login_uses_email(rf):
    User.objects.create_user('Ana@example.com', 'strong-password')
    request = rf.post('/login/', REMOTE_ADDR='10.0.0.1')
    assert authenticate(
        request=request,
        email='  ANA@Example.COM ',
        password='strong-password',
    ) is not None


@pytest.mark.django_db
def test_argon2_is_default_password_hasher():
    user = User.objects.create_user('argon@example.com', 'strong-password')
    assert user.password.startswith('argon2')


@pytest.mark.django_db
def test_axes_rejects_sixth_login_attempt_after_five_failures(rf):
    User.objects.create_user('locked@example.com', 'strong-password')
    for _ in range(5):
        request = rf.post('/login/', REMOTE_ADDR='10.0.0.2')
        assert authenticate(
            request=request,
            email='LOCKED@example.com',
            password='wrong-password',
        ) is None
    request = rf.post('/login/', REMOTE_ADDR='10.0.0.2')
    assert authenticate(
        request=request,
        email='locked@example.com',
        password='strong-password',
    ) is None


@pytest.mark.django_db
def test_user_admin_change_and_add_pages_load(client):
    admin = User.objects.create_superuser('admin@example.com', 'strong-password')
    client.force_login(admin)

    assert client.get(reverse('admin:accounts_user_change', args=[admin.pk])).status_code == 200
    assert client.get(reverse('admin:accounts_user_add')).status_code == 200
