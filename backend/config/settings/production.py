from .base import *  # noqa: F401, F403
from .base import env
from django.core.exceptions import ImproperlyConfigured

SECRET_KEY = env('SECRET_KEY')
if (
    len(SECRET_KEY) < 50
    or SECRET_KEY == 'change-me'
    or SECRET_KEY.startswith('django-insecure-')
):
    raise ImproperlyConfigured('SECRET_KEY de producción debe ser fuerte y única.')

ALLOWED_HOSTS = env.list('ALLOWED_HOSTS')
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])

DEBUG = False

SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

MIDDLEWARE = ['whitenoise.middleware.WhiteNoiseMiddleware'] + MIDDLEWARE  # noqa: F405
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

TRUSTED_PROXY_COUNT = env.int('TRUSTED_PROXY_COUNT', default=1)
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    'NUM_PROXIES': TRUSTED_PROXY_COUNT,
}
REDIS_URL = env('REDIS_URL', default='redis://127.0.0.1:6379/0')
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': REDIS_URL,
    }
}

