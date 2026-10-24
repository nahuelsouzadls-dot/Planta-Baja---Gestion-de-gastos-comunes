from .base import *  # noqa: F401, F403

DEBUG = True

ALLOWED_HOSTS = ['*']

CORS_ALLOW_ALL_ORIGINS = True

INSTALLED_APPS += ['django_extensions']  # noqa: F405

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
FRONTEND_BASE_URL = 'http://localhost:8000'
