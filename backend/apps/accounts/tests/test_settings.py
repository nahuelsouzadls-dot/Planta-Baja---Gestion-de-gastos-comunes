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


def test_production_uses_redis_cache_and_trusted_proxy_count(monkeypatch):
    import sys

    monkeypatch.setenv('SECRET_KEY', 'x' * 64)
    monkeypatch.setenv('ALLOWED_HOSTS', 'example.com')
    monkeypatch.setenv('REDIS_URL', 'redis://redis.internal:6379/1')
    sys.modules.pop('config.settings.production', None)
    prod = importlib.import_module('config.settings.production')
    assert prod.TRUSTED_PROXY_COUNT == 1
    assert prod.CACHES['default']['BACKEND'] == 'django.core.cache.backends.redis.RedisCache'
    assert prod.CACHES['default']['LOCATION'] == 'redis://redis.internal:6379/1'
    sys.modules.pop('config.settings.production', None)

