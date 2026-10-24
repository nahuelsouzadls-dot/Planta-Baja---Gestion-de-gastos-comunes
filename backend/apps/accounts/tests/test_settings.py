import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
import importlib


def test_drf_requires_authenticated_session_by_default():
    assert settings.REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'] == [
        'rest_framework.permissions.IsAuthenticated',
    ]
    assert settings.REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES'] == [
        'rest_framework.authentication.SessionAuthentication',
    ]


def test_production_rejects_weak_secret(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'change-me')
    monkeypatch.setenv('ALLOWED_HOSTS', 'example.com')

    with pytest.raises(ImproperlyConfigured):
        importlib.import_module('config.settings.production')
