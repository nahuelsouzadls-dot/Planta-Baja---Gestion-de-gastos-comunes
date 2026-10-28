# Tarea: SEC4 — Sacar las credenciales del `docker-compose.yml`

## Contexto
Pedido de Nahuel (2026-10-28): que no haya contraseñas ni datos sensibles escritos en archivos del repo. Hoy `docker-compose.yml` tiene la base escrita a mano:

```yaml
db:
  environment:
    POSTGRES_DB: propiedad_horizontal
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
```

y `web` toma `DB_USER`/`DB_PASSWORD` de `backend/.env`, que tiene que repetir los mismos valores a mano. MinIO ya lee sus credenciales de `backend/.env` (bien).

Son credenciales de desarrollo local (el puerto se publica solo en `127.0.0.1`), pero el criterio es que ningún valor sensible viva en el repo, ni siquiera los de desarrollo.

## Decisiones
- **Una sola fuente:** `backend/.env` (ya está en `.gitignore`). Ahí van `DB_NAME`, `DB_USER` y `DB_PASSWORD`; el servicio `db` los toma de ahí y nada se repite.
  - `db` lee `backend/.env` con `env_file` y mapea `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD` con interpolación (`${DB_PASSWORD:?Falta DB_PASSWORD en backend/.env}`), para que `docker compose` falle con un mensaje claro si falta.
  - Para que la interpolación lea `backend/.env` sin un `.env` en la raíz: todos los comandos del `Makefile` usan `docker compose --env-file backend/.env` (definir `COMPOSE := docker compose --env-file backend/.env` arriba del `Makefile`). Documentar que, si se usa `docker compose` a mano, hay que pasar el mismo `--env-file`.
  - El `healthcheck` usa la variable del contenedor: `pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"`.
- **`backend/.env.example`** queda sin contraseñas reales: `DB_PASSWORD=` vacío y `MINIO_ROOT_PASSWORD=` vacío, con un comentario que diga cómo generarlas (`python3 -c "import secrets; print(secrets.token_urlsafe(24))"`).
- **CI (`.github/workflows/ci.yml`):** la base de la CI es efímera y no expone nada, pero para cumplir la regla se pasa la contraseña desde un *secret* de GitHub (`secrets.CI_DB_PASSWORD`) o se genera al vuelo en un paso previo. Documentar cuál se eligió en `docs/ci.md`.
- **Coordinar con E2** (roles `gc_owner` / `gc_app`): E2 también pone contraseñas en `backend/.env`. Si E2 se hace primero, SEC4 solo tiene que quitar lo que quede escrito; si SEC4 va primero, dejar los nombres de variables pensados para sumar `DB_OWNER_USER`/`DB_OWNER_PASSWORD` después.

## Cuidado
- **Cambiar la contraseña de Postgres no afecta un volumen ya creado:** Postgres solo usa `POSTGRES_PASSWORD` al inicializar la base por primera vez. Cada máquina tiene que hacer `make reset-db` después del cambio (y volver a `make migrate` y `make seed`). Avisarlo en `docs/docker.md` y en la guía de varias máquinas de `.ai_orchestration/roles/agent-arquitecto.md`.
- Los valores viejos (`postgres`/`postgres`) **ya están en el historial de git**. Como eran de desarrollo y no se usan en producción, no hace falta reescribir el historial, pero no hay que reutilizarlos en ningún ambiente real.

## Tests / verificación
- `git grep -nE "POSTGRES_PASSWORD: |DB_PASSWORD=postgres|PASSWORD=.+"` sobre archivos versionados no encuentra contraseñas con valor.
- Con `backend/.env` sin `DB_PASSWORD`, `make up` falla con el mensaje de la interpolación.
- Con `backend/.env` completo: `make reset-db && make up && make migrate && make seed DEMO_PASSWORD=...` y `make test` pasan.
- La CI pasa en verde.
