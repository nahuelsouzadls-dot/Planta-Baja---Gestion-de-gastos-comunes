# Tarea: E3 — Integración continua en GitHub Actions

## Contexto
El backend tiene 150 tests que hoy solo corren cuando alguien los lanza a mano. Queremos que **cada push y cada pull request** los corra solo, igual que en Docker. Leé `docker-compose.yml`, `backend/Dockerfile.dev`, `backend/requirements/` y `backend/pytest.ini`. Ver `docs/plan-mvp.md` (E3).

Esta vez **sí escribís archivos** (es una tarea de implementación, no de revisión), pero solo los tuyos.

## Archivos tuyos
- `.github/workflows/ci.yml` (nuevo)
- `docs/ci.md` (nuevo, corto)

**No toques nada más**: el implementador está trabajando en `backend/` (C1). En particular, no toques `.github/copilot-instructions.md` ni las carpetas `.github/agents`, `.github/hooks` y `.github/skills`.

## Qué tiene que hacer el workflow
- Se dispara en `push` a cualquier rama y en `pull_request` a `main`.
- Job `backend`, en `ubuntu-latest`, con un **servicio `postgres:16-alpine`** (usuario `postgres`, contraseña de prueba, base `propiedad_horizontal`) con healthcheck.
- Python **3.12** (el mismo de la imagen), con caché de pip por `backend/requirements/*.txt`.
- Instala `requirements/development.txt`.
- Variables de entorno para los tests: `DJANGO_SETTINGS_MODULE=config.settings.development`, `SECRET_KEY` de prueba, `DEBUG=True`, `ALLOWED_HOSTS=localhost`, `DB_*` apuntando al servicio y `GOLDEN_PATH` al `docs/golden/demo.json` del checkout (los tests de golden **no** pueden quedar en `skipped` en CI).
- Pasos, desde `backend/`:
  1. `python manage.py makemigrations --check --dry-run`
  2. `pytest -q -p no:cacheprovider` (que falle el job si algo falla o si hay tests `skipped`: usá `-rs` y verificá la salida, o `--strict-markers` más un chequeo de que no haya skips)
  3. `python manage.py check --deploy` con `DJANGO_SETTINGS_MODULE=config.settings.production` y una `SECRET_KEY` de prueba **generada en el paso** (larga y aleatoria; nunca una fija en el YAML), `ALLOWED_HOSTS=example.com` y `CSRF_TRUSTED_ORIGINS=https://example.com`. Que falle si aparece algún warning que no esté en una lista explícita de excepciones justificadas (si no hay ninguno, mejor).
- **Seguridad del workflow:** `permissions: contents: read` a nivel de workflow; acciones fijadas a una versión (`actions/checkout@v4`, `actions/setup-python@v5`, etc.); sin secretos (no hacen falta); `concurrency` para cancelar corridas viejas de la misma rama.

## `docs/ci.md`
Qué corre, cómo reproducirlo localmente con Docker y cómo agregar una excepción a `check --deploy` si alguna vez hiciera falta (y que hay que justificarla).

## Cómo verificar (pegalo en el reporte)
1. Validá la sintaxis del YAML (por ejemplo con `python -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"`; si tenés `actionlint`, mejor).
2. Simulá los pasos localmente con Docker: corré los mismos comandos (`makemigrations --check`, `pytest` y `check --deploy` con la `SECRET_KEY` generada) dentro de `docker compose run --rm web` y pegá las salidas. Usá **otra base** para no chocar con el implementador: `-e DB_NAME=ci_check`.
3. No hagas push ni commit: lo hace el orquestador.
