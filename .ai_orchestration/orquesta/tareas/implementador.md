# Tarea: B0 — Reset del backend y bases (usuario, organización, seguridad)

## Contexto
Leé primero `docs/modelo-datos.md` (el modelo aprobado) y `.github/copilot-instructions.md`.
El backend actual (`backend/apps/buildings`, `residents`, `expenses`, `ledger`) es un esqueleto anterior al diseño y **se descarta entero**: no hay datos reales, así que se borran las apps y sus migraciones y se arranca de cero. Esta tarea deja solo las bases; los modelos de negocio vienen en B1–B9, una tarea por vez.

## Archivos tuyos
- `backend/apps/` (todo: borrás las apps viejas y creás `core` y `accounts`)
- `backend/config/settings/base.py`, `development.py`, `production.py`
- `backend/config/urls.py`
- `backend/requirements/base.txt`, `production.txt`
- `backend/conftest.py`, `backend/tests/` (todo)
- `backend/.env.example`
- `docker-compose.yml` (solo la línea `env_file`)
- `README.md` (solo la sección de cómo levantar el backend, si existe; si no existe, agregala)

No toques `design/`, `docs/` ni `.ai_orchestration/`.

## Pasos

### 1. Borrar lo viejo
- Borrá `backend/apps/buildings/`, `backend/apps/residents/`, `backend/apps/expenses/` y `backend/apps/ledger/` completas (modelos, vistas, serializers, URLs, tests, migraciones, comando `seed_data`).
- Sacá sus `include(...)` de `config/urls.py`: quedan solo `admin/`.
- Vaciá los fixtures de `backend/conftest.py` y reescribí `backend/tests/factories.py` y `backend/tests/conftest.py` para las entidades nuevas (paso 4).

### 2. App `apps.core`
- `apps/core/models.py` con dos modelos **abstractos**:
  - `UUIDModel`: `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)`.
  - `TimeStampedModel(UUIDModel)`: `created_at` (`auto_now_add`) y `updated_at` (`auto_now`).
- Una migración `0001` en `core` que **solo** active la extensión de Postgres `btree_gist` (`django.contrib.postgres.operations.BtreeGistExtension`). La usa B2. Agregá `django.contrib.postgres` a `INSTALLED_APPS`.

### 3. App `apps.accounts`
- `User` propio: `AbstractBaseUser` + `PermissionsMixin`, heredando de `UUIDModel`.
  - Campos: `email` (único), `first_name`, `last_name`, `is_active` (default `True`), `is_staff` (default `False`), `date_joined`.
  - `USERNAME_FIELD = 'email'`, `REQUIRED_FIELDS = []`. Sin `username`.
  - El email se guarda **siempre en minúsculas y sin espacios** (normalizalo en el manager y en `save()`), con `UniqueConstraint(Lower('email'), name=...)` para que `Ana@x.com` y `ana@x.com` no puedan coexistir.
  - `UserManager` con `create_user(email, password=None, **extra)` y `create_superuser(...)`. Si falta el email, `ValueError`.
- `Organization(TimeStampedModel)`: `name`, `tax_id` (blank), `email` (blank).
- `OrgMembership(TimeStampedModel)`: FK `user` y FK `organization`, ambas `on_delete=PROTECT`, con `UniqueConstraint(user, organization)`. Todos los miembros tienen los mismos permisos: **no agregues campo de rol**.
- `admin.py`: registrá los tres. Para `User`, adaptá `UserAdmin` a email (sin `username`) y no muestres el hash de la contraseña.
- `AUTH_USER_MODEL = 'accounts.User'` en `base.py`.

### 4. Tests y factories
En `backend/tests/factories.py`: `UserFactory` (email único con `Sequence`, contraseña con `make_password` o `PostGenerationMethodCall('set_password', ...)`), `OrganizationFactory` y `OrgMembershipFactory`.
Tests en `backend/apps/accounts/tests/`:
- `create_user` normaliza el email (`'  Ana@Example.COM '` → `'ana@example.com'`).
- No se pueden crear dos usuarios cuyos emails difieren solo en mayúsculas (`IntegrityError`).
- `create_user` sin email lanza `ValueError`; `create_superuser` deja `is_staff` e `is_superuser` en `True`.
- `client.login(email=..., password=...)` funciona.
- El hasher por defecto es Argon2 (`user.password.startswith('argon2')`).
- Tras 5 intentos de login fallidos, el sexto (aunque sea con la contraseña correcta) es rechazado por axes. Usá `django.test.Client` y `axes` real, no mocks.
- `OrgMembership` duplicado (mismo usuario y organización) → `IntegrityError`.
- La configuración de DRF tiene `IsAuthenticated` como permiso por defecto y `SessionAuthentication` como autenticación.

### 5. Seguridad en settings
En `base.py`:
- **Variables de entorno:** leé `BASE_DIR / '.env'` solo si existe (`if (BASE_DIR / '.env').exists(): environ.Env.read_env(...)`). **No leas más `.env.example`.**
- `PASSWORD_HASHERS` con `Argon2PasswordHasher` primero (agregá `argon2-cffi` a `requirements/base.txt`) y los de Django después, para poder migrar hashes.
- `MinimumLengthValidator` con `min_length: 10`.
- `django-axes` (agregalo a `requirements/base.txt`): en `INSTALLED_APPS`, `axes.middleware.AxesMiddleware` **al final** de `MIDDLEWARE`, `AUTHENTICATION_BACKENDS = ['axes.backends.AxesStandaloneBackend', 'django.contrib.auth.backends.ModelBackend']`, `AXES_FAILURE_LIMIT = 5`, `AXES_COOLOFF_TIME = 1` (horas), `AXES_LOCKOUT_PARAMETERS = [['username', 'ip_address']]` y `AXES_USERNAME_FORM_FIELD = 'email'`.
- Cookies: `SESSION_COOKIE_HTTPONLY = True`, `SESSION_COOKIE_SAMESITE = 'Lax'`, `CSRF_COOKIE_SAMESITE = 'Lax'`, `SESSION_COOKIE_AGE = 60 * 60 * 8`.
- DRF: `DEFAULT_AUTHENTICATION_CLASSES = ['rest_framework.authentication.SessionAuthentication']` y `DEFAULT_PERMISSION_CLASSES = ['rest_framework.permissions.IsAuthenticated']`.
- `DEFAULT_AUTO_FIELD` puede quedar, pero todos los modelos nuevos usan `UUIDModel`.

En `production.py`:
- Borrá `CORS_ALLOWED_ORIGINS`: el front se sirve desde el mismo dominio y no se instala `django-cors-headers`.
- `STATICFILES_STORAGE` ya no existe en Django 5.1: reemplazalo por `STORAGES = {'default': {...FileSystemStorage}, 'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'}}`.
- Agregá `SECURE_CONTENT_TYPE_NOSNIFF = True`, `SECURE_REFERRER_POLICY = 'same-origin'`, `X_FRAME_OPTIONS = 'DENY'` y `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')` (Railway termina TLS en el proxy).

`.env.example`: mismas claves, pero `SECRET_KEY=change-me` (sin valores que parezcan reales).
`docker-compose.yml`: `env_file: ./backend/.env`.
`README.md`: cómo levantar el backend (`cp backend/.env.example backend/.env`, generar una `SECRET_KEY` con `python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"`, `docker compose up`, `migrate`, `createsuperuser`, correr tests).

### 6. Migraciones
- Borrá todas las migraciones viejas (vienen con las apps del paso 1).
- `makemigrations core accounts` y verificá que `migrate` corra **desde una base vacía**: `docker compose down -v` y después `docker compose up -d db`.

## Cómo verificar (correlo y pegá el resultado resumido en el reporte)
1. `python manage.py makemigrations --check --dry-run` → "No changes detected".
2. Base vacía, `python manage.py migrate` → sin errores.
3. `pytest` → todo verde; pegá el conteo de tests.
4. `DJANGO_SETTINGS_MODULE=config.settings.production SECRET_KEY=x DB_NAME=x DB_USER=x DB_PASSWORD=x ALLOWED_HOSTS=example.com python manage.py check --deploy` → pegá los warnings que queden (no hace falta que sean cero, pero explicá cada uno).
5. `grep -rn "django.contrib.auth.models import User" backend/` → sin resultados.

## Fuera de alcance
Edificios, personas, liquidaciones, libro mayor, API y login con pantalla: vienen en B1 en adelante y en el plan C. No crees endpoints.
