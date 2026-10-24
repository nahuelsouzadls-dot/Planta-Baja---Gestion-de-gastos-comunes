# Tarea: C4a — Servir el front desde Django y conectar la sesión

## Contexto
La API está completa (C1–C3) y el front está cerrado en `design/` (ADR-0002: Django lo sirve como estático y el JS consume `/api/v1/`). Esta tarea arma **la infraestructura** de la conexión; las pantallas se conectan en C4b (panel) y C4c (portal). Leé `docs/adr/0002`, `0005` y `design/DISENO.md`.

**Regla del front:** el diseño está aprobado. **No cambies el HTML ni el CSS** salvo lo mínimo para conectar (por ejemplo, un `id` o un `data-` para encontrar un elemento). Toda la lógica nueva va en JS.

## Decisiones
1. **Dónde vive el front en el deploy.** El `Dockerfile` de producción hoy construye con `backend/` como contexto, y `design/` queda afuera. Pasá el contexto de build a la **raíz del repo** y copiá `design/` a la imagen como fuente de estáticos (`STATICFILES_DIRS`). No dupliques los archivos en el repo.
2. **Rutas del front (app `apps/frontend/`):** `GET /` → redirige según la sesión (empleado → `/panel`, residente → `/portal`, sin sesión → `/ingresar`); `/panel` sirve `admin.html`; `/portal` sirve `portal-residente.html`; `/ingresar` sirve `gc-login-residente.html` y `/ingresar/administracion` `gc-login-admin.html`; `/aceptar-invitacion` y `/recuperar-contrasena` (pantalla simple con el estilo de los logins). Todas con `ensure_csrf_cookie`. `/panel` y `/portal` sin sesión → redirigen a su login.
3. **Cliente de API (`design/assets/api.js`):** un único módulo `GC.api` con `get`, `post`, `put`, `patch` y `delete` que: manda `credentials: 'same-origin'`; agrega `X-CSRFToken` leyendo la cookie en toda escritura; parsea `{detail, errors}` y lanza un error con ese mensaje; ante **401/403 de sesión** redirige al login correspondiente; ante 429 muestra "Demasiados intentos, probá en unos minutos". **Montos siempre como string**: el cliente nunca convierte a `Number` lo que va a la API, y para mostrar usa `GC.fmt` (ya existe).
4. **Logins (`gc-login-admin.html`, `gc-login-residente.html`):** el formulario llama a `POST /api/v1/auth/login` y redirige a `/panel` o `/portal`. Error de credenciales: el mensaje único de la API. Enlace "Olvidé mi contraseña" → `/recuperar-contrasena`. En el login de residente, **sacar "o número de apartamento"** del texto y del campo (N5: se entra con email).
5. **Cerrar sesión:** botón en la barra del panel y del portal → `POST /api/v1/auth/logout`.
6. **El modo demo con `localStorage` se retira**, pero sin borrar el código todavía: `GC.store` deja de usarse en C4b/C4c. Dejá un aviso en `core.js`.

## Archivos tuyos
`backend/apps/frontend/` (nueva), `backend/config/settings/`, `backend/config/urls.py`, `backend/Dockerfile`, `docker-compose.yml` (montar `design/` en `web` para desarrollo), `design/assets/api.js` (nuevo), `design/gc-login-admin.html`, `design/gc-login-residente.html` y las dos pantallas nuevas (aceptar invitación, recuperar contraseña).

## Tests
- Django: cada ruta del front responde con el HTML correcto, setea la cookie CSRF, y `/panel` y `/portal` sin sesión redirigen al login; un residente que pide `/panel` va a `/portal` y al revés.
- **De punta a punta** con Playwright (agregalo a `requirements/development.txt` y documentá cómo instalar el navegador en el contenedor) o, si no es viable en Docker, con el cliente de Django + un test de JS mínimo: login como María Fernández desde `gc-login-admin.html` → llega a `/panel`; login con contraseña mala → mensaje único; logout → vuelve al login.
- La imagen de producción incluye los estáticos del front (`collectstatic` encuentra `admin.html`, `assets/admin.css`, etc.).

## Cómo verificar
Suite verde; `docker build` con el contexto nuevo; `make up` y, con la demo cargada, entrar a `http://localhost:8000/` en el navegador y loguearse como María Fernández. Pegá capturas o la salida de Playwright.
