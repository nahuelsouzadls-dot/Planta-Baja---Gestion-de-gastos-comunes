from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, []),
)

if (BASE_DIR / '.env').exists():
    environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('SECRET_KEY')

DEBUG = env('DEBUG')

ALLOWED_HOSTS = env('ALLOWED_HOSTS')

DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'drf_spectacular',
    'axes',
]

LOCAL_APPS = [
    'apps.api',
    'apps.core',
    'apps.accounts',
    'apps.buildings',
    'apps.people',
    'apps.settlements',
    'apps.ledger',
    'apps.communications',
    'apps.audit',
    'apps.demo',
    'apps.frontend',
    'apps.storage',
    'apps.documents',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.audit.context.AuditContextMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'axes.middleware.AxesMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME'),
        'USER': env('DB_USER'),
        'PASSWORD': env('DB_PASSWORD'),
        'HOST': env('DB_HOST', default='localhost'),
        'PORT': env('DB_PORT', default='5432'),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 10},
    },
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'es-UY'
TIME_ZONE = 'America/Montevideo'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# El front (ADR-0018) es la app React de frontend/, compilada con Vite en frontend/dist.
# apps.frontend sirve su index.html en cada pantalla y el resto del build va como
# estáticos en /static/app/ (Vite compila con base '/static/app/'). En Docker se monta
# o copia en /frontend/dist.
FRONTEND_DIR = Path(env('FRONTEND_DIR', default=str(BASE_DIR.parent / 'frontend' / 'dist')))
STATICFILES_DIRS = [('app', FRONTEND_DIR)]

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTH_USER_MODEL = 'accounts.User'
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
    'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
    'django.contrib.auth.hashers.ScryptPasswordHasher',
]
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1
AXES_LOCKOUT_PARAMETERS = [['username', 'ip_address']]
AXES_USERNAME_FORM_FIELD = 'email'
AXES_USERNAME_CALLABLE = 'apps.accounts.axes.get_username'
AXES_CLIENT_IP_CALLABLE = 'apps.core.net.client_ip'
TRUSTED_PROXY_COUNT = env.int('TRUSTED_PROXY_COUNT', default=0)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_AGE = 60 * 60 * 8

REST_FRAMEWORK = {
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'NUM_PROXIES': TRUSTED_PROXY_COUNT,
    'DEFAULT_THROTTLE_CLASSES': [
        'apps.core.net.ClientIPScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
        'invitation_accept': '10/hour',
        'password_reset': '5/hour',
        'password_reset_confirm': '5/hour',
    },
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Administración GC API',
    'DESCRIPTION': 'API del panel y portal de Administración GC.',
    'VERSION': '1.0.0',
    'SERVE_PERMISSIONS': ['apps.api.permissions.IsEmployee'],
}

FRONTEND_BASE_URL = env('FRONTEND_BASE_URL', default='')
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='no-reply@example.com')

# Almacenamiento S3 (ADR-0012): MinIO en Docker, Cloudflare R2 en producción. El backend
# habla con S3_ENDPOINT_URL; las URLs firmadas que usa el navegador se firman contra
# S3_PUBLIC_ENDPOINT_URL. En R2 hay que permitir CORS (POST y GET) desde el dominio del front.
S3_ENDPOINT_URL = env('S3_ENDPOINT_URL', default='')
S3_PUBLIC_ENDPOINT_URL = env('S3_PUBLIC_ENDPOINT_URL', default=S3_ENDPOINT_URL)
S3_ACCESS_KEY_ID = env('S3_ACCESS_KEY_ID', default=env('MINIO_ROOT_USER', default=''))
S3_SECRET_ACCESS_KEY = env('S3_SECRET_ACCESS_KEY', default=env('MINIO_ROOT_PASSWORD', default=''))
S3_BUCKET = env('S3_BUCKET', default=env('MINIO_BUCKET_NAME', default='comprobantes'))
S3_REGION = env('S3_REGION', default='us-east-1')

