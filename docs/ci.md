# Integración Continua (CI)

El workflow `.github/workflows/ci.yml` se ejecuta automáticamente en cada `push` a cualquier rama y en cada `pull_request` hacia `main`.

## Qué corre

En un entorno `ubuntu-latest` con Python 3.12 y un servicio `postgres:16-alpine`:

1. **`makemigrations --check --dry-run`**: verifica que no existan cambios en los modelos sin su migración correspondiente.
2. **`pytest -q -p no:cacheprovider -rs --strict-markers`**: corre toda la suite de tests contra PostgreSQL con `GOLDEN_PATH` apuntando a `docs/golden/demo.json`. Falla si cualquier test falla o queda en estado `skipped`.
3. **`check --deploy`**: valida `config.settings.production` con una `SECRET_KEY` aleatoria generada en el momento, `ALLOWED_HOSTS=example.com` y `CSRF_TRUSTED_ORIGINS=https://example.com`. Falla ante cualquier error o warning no exceptuado (`--fail-level WARNING`).

## Cómo reproducirlo localmente con Docker

Con el servicio `db` levantado (`docker compose up -d db`), ejecutá los tres pasos usando una base separada (`ci_check`) para no interferir con la base de desarrollo:

```bash
# 1. Crear base temporal si no existe (para que makemigrations verifique historial sin warnings)
docker compose exec db psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'ci_check'" | grep -q 1 \
  || docker compose exec db psql -U postgres -c "CREATE DATABASE ci_check;"

# 2. Verificar migraciones pendientes
docker compose run --rm -e DB_NAME=ci_check web \
  python manage.py makemigrations --check --dry-run

# 3. Correr la suite de tests verificando que no haya skips
docker compose run --rm -e DB_NAME=ci_check web sh -c '
  set -eu
  output=$(pytest -q -p no:cacheprovider -rs --strict-markers | tee /dev/stderr)
  if echo "$output" | grep -Eq "[0-9]+ skipped"; then
    echo "Error: hay tests en estado skipped." >&2
    exit 1
  fi
'

# 4. Verificar configuración de despliegue (producción)
docker compose run --rm \
  -e DB_NAME=ci_check \
  -e DJANGO_SETTINGS_MODULE=config.settings.production \
  -e ALLOWED_HOSTS=example.com \
  -e CSRF_TRUSTED_ORIGINS=https://example.com \
  web sh -c '
    SECRET_KEY="$(python -c "import secrets; print(secrets.token_urlsafe(64))")" \
    python manage.py check --deploy --fail-level WARNING
  '
```

## Cómo agregar una excepción a `check --deploy`

Por defecto **ningún warning está permitido**. Si en algún momento fuera indispensable exceptuar un warning específico de Django (por ejemplo `security.Wxxx`):

1. **Justificar el motivo**: documentar en un comentario junto a la excepción *por qué* el control no aplica o cómo se mitiga por fuera de Django (por ejemplo, en el proxy o plataforma), e indicar bajo qué condición se eliminará la excepción.
2. **Registrar el código exacto**:
   - En `.github/workflows/ci.yml`, agregar el código al arreglo `ALLOWED_WARNINGS=("security.Wxxx")` del paso `Verificar configuración de producción (check --deploy)`, o bien
   - En `backend/config/settings/production.py`, agregarlo a `SILENCED_SYSTEM_CHECKS = ['security.Wxxx']` si también debe silenciarse fuera de CI.
3. Nunca desactivar `--deploy` ni silenciar errores (`*.E*`).
