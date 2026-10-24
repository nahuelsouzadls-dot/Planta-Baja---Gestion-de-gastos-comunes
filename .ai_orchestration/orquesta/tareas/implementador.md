# Tarea: C1 — API de sesión e invitaciones

## Contexto
El modelo de datos está cerrado (B0–B9, SEC1, SEC2; commit `23fa98a`). Arranca la API. Leé `docs/plan-mvp.md` (sección C), `docs/adr/0002`, `0004`, `0005` y `0016`, y `docs/arquitectura/secuencias.md` §6 (invitación) y §7 (login).

**Decisión de estructura:** la API vive en una app nueva, `apps/api/`, con un paquete por versión (`apps/api/v1/`). Las vistas y serializers **solo traducen HTTP**: validan la entrada, resuelven permisos y llaman a un **servicio de dominio**. Ninguna regla de negocio en las vistas. Todo bajo `/api/v1/`.

## Archivos tuyos
- `backend/apps/api/` (app nueva)
- `backend/apps/accounts/` (modelo `Invitation`, servicios de invitación y recuperación, migración, tests)
- `backend/config/urls.py`, `backend/config/settings/base.py` y `development.py` (email y throttling)
- `backend/tests/factories.py`

## 1. Modelo `Invitation` (`apps/accounts/models.py`)
`TimeStampedModel`. Sirve para empleados y residentes:
- `organization` → FK `Organization`, `PROTECT`
- `kind`: `employee` | `resident`
- `person` → FK `people.Person`, null, `PROTECT` (solo para `resident`)
- `email` (normalizado), `first_name` y `last_name` (solo para `employee`; para `resident` salen de la persona)
- `token_hash` (CharField 64, **único**): sha256 del token; **el token en claro nunca se guarda**
- `expires_at`, `used_at` (null), `revoked_at` (null), `created_by` → FK user, `PROTECT`
- Constraints: `resident` ⇔ `person` no nula; `employee` ⇔ `person` nula.
- Engancharla al log con `AuditTrigger` excluyendo `token_hash`.

## 2. Servicios (`apps/accounts/invitations.py`)
Todo en `transaction.atomic()` y `audit_context`; los eventos con `record_event` (B8).
- `invite_employee(organization, user, *, email, first_name, last_name) -> (Invitation, token)`: `assert_member`. Si ya hay un empleado con ese email en la organización → `ValidationError`.
- `invite_resident(person, user) -> (Invitation, token)`: `assert_member` de la organización de la persona; la persona tiene email y todavía no tiene cuenta (si no, `ValidationError` claro).
- Ambas: token = `secrets.token_urlsafe(32)`; vence en 72 h; **revocan** (`revoked_at`) las invitaciones vigentes anteriores para ese email y organización; envían el email con `transaction.on_commit` (por ahora `send_mail` directo; en D2/D3 pasa a Celery). El link: `{FRONTEND_BASE_URL}/aceptar-invitacion?token=<token>`.
- `accept_invitation(token, password, *, first_name=None, last_name=None) -> User`: busca por `sha256(token)` con `select_for_update`; tiene que existir, no estar usada, ni revocada, ni vencida (un **único** mensaje para todos los casos: "El link no es válido o venció"). Valida la contraseña con los validadores de Django.
  - Si **no** existe un `User` con ese email: lo crea.
  - Si **ya** existe (el mismo humano en otra organización, D8): no cambia su contraseña; exige que la que mandó sea la suya (`check_password`), y si no coincide, el mismo mensaje genérico.
  - `employee` → crea el `OrgMembership`; `resident` → setea `person.user`. Marca `used_at`.
- **Recuperar contraseña:** `request_password_reset(email)` y `confirm_password_reset(uid, token, password)` con `PasswordResetTokenGenerator` de Django. `request_password_reset` **no revela** si el email existe: siempre termina igual.

## 3. Endpoints (`apps/api/v1/auth.py`)
DRF con `SessionAuthentication` + CSRF. Respuestas de error con forma `{"detail": "..."}`.
| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /api/v1/auth/csrf` | cualquiera | setea la cookie CSRF (`ensure_csrf_cookie`); 204 |
| `POST /api/v1/auth/login` | cualquiera | `{email, password}` → `authenticate(request, email=…, password=…)` (axes funciona) y `login()` (rota la sesión). Falla → 400 `"Email o contraseña incorrectos"`, **siempre el mismo mensaje**. Bloqueado por axes → 429 |
| `POST /api/v1/auth/logout` | autenticado | cierra la sesión; 204 |
| `GET /api/v1/auth/me` | autenticado | `{id, email, first_name, last_name, organizations: [{id, name}], persons: [{id, organization_id, occupancies: [{id, unit_number, building_name, role, start_date, end_date}]}]}`. **Sin** hash, sin permisos internos |
| `POST /api/v1/invitations/employees` | empleado | invita a un empleado de **su** organización |
| `POST /api/v1/invitations/residents` | empleado | `{person_id}`; la persona tiene que ser de su organización (si no, **404**) |
| `POST /api/v1/invitations/accept` | cualquiera | `{token, password, first_name?, last_name?}` → acepta e **inicia sesión** |
| `POST /api/v1/auth/password-reset` | cualquiera | `{email}` → 204 siempre |
| `POST /api/v1/auth/password-reset/confirm` | cualquiera | `{uid, token, password}` |

- **Throttling** (DRF `ScopedRateThrottle`): `login` 10/min, `invitation_accept` 10/hora, `password_reset` 5/hora, por IP.
- Los endpoints públicos (`csrf`, `login`, `accept`, `password-reset*`) son los **únicos** con `AllowAny`; todo lo demás hereda `IsAuthenticated`.

## 4. Configuración
- `development.py`: `EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'`, `FRONTEND_BASE_URL = 'http://localhost:8000'`.
- `base.py`: `FRONTEND_BASE_URL = env('FRONTEND_BASE_URL', default='')`, `DEFAULT_FROM_EMAIL` desde el entorno, y las tasas de throttling.

## 5. Tests (`apps/api/tests/test_auth.py` y `apps/accounts/tests/test_invitations.py`)
Usá el cliente de DRF (`APIClient(enforce_csrf_checks=True)`) **con CSRF activado**: primero `GET /auth/csrf` y después mandar el header `X-CSRFToken`.
1. Login correcto → 200 y sesión; sin CSRF → 403; contraseña mala o email inexistente → 400 con el **mismo** texto; email con mayúsculas y espacios funciona.
2. Tras 5 fallos, el sexto → 429 (axes), aun con la contraseña correcta.
3. `me` sin sesión → 403; con sesión devuelve sus organizaciones y personas, y **no** incluye `password`.
4. `logout` → la sesión deja de valer.
5. Invitar empleado: lo hace un empleado → 201 y un email en `mail.outbox` con el link; un empleado de **otra** organización → 404 o 403 sin crear nada; un residente → 403.
6. Invitar residente: persona de otra organización → 404; persona sin email o que ya tiene cuenta → 400.
7. Aceptar: token válido → crea el usuario, liga la membresía o la persona e inicia sesión; el mismo token otra vez, uno vencido o uno revocado (por reenvío) → 400 con el **mismo** mensaje; contraseña débil → 400. El token en claro **no** aparece en la base (buscalo en `accounts_invitation` y en `audit_rowchange`).
8. Aceptar con un email que ya tiene usuario: con su contraseña correcta, liga sin cambiarla; con otra, el mensaje genérico.
9. Recuperar contraseña: email existente y no existente devuelven lo mismo (204) y solo el existente recibe email; confirmar con el token cambia la contraseña; un token usado o alterado → 400.
10. Throttling: el 11.º login en un minuto desde la misma IP → 429.
11. Cada invitación y cada aceptación dejan su `AuditLog`.

## Cómo verificar (pegalo en el reporte)
```bash
docker compose exec -T db dropdb -U postgres --if-exists test_propiedad_horizontal
docker compose run --rm web pytest -q -p no:cacheprovider
docker compose run --rm web python manage.py makemigrations --check --dry-run
```
1. Suite completa → verde, con el conteo total (eran 150). Si algo queda en rojo: `ESTADO: bloqueado`.
2. Pegá un email de invitación real impreso por el backend de consola (sin el token: reemplazalo por `<token>`).
3. Qué test cubre cada punto del 1 al 11.
