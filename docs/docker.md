# Entorno Docker — Administración GC

Este documento describe los servicios de contenedores del proyecto, cómo levantar el entorno local desde cero y las diferencias entre la imagen de desarrollo (`backend/Dockerfile.dev`) y la de producción (`backend/Dockerfile`).

## Servicios en `docker-compose.yml`

Todos los puertos de desarrollo se publican únicamente en `127.0.0.1` (no quedan expuestos en la red local) y todas las imágenes tienen versión fijada y `healthcheck`.

| Servicio | Imagen | Puertos locales (`127.0.0.1`) | URL / Acceso local | Propósito |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | `5434` → `5432` | `postgresql://postgres:postgres@127.0.0.1:5434/propiedad_horizontal` | Base de datos PostgreSQL 16 con volumen persistente (`postgres_data`). |
| `redis` | `redis:7-alpine` | `6379` → `6379` | `redis://127.0.0.1:6379/0` | Broker y backend de resultados para Celery y caché (sin persistencia en disco en desarrollo). |
| `mailpit` | `axllent/mailpit:v1.32.0` | `1025` (SMTP)<br>`8025` (Web) | Interfaz web: `http://localhost:8025`<br>SMTP: `127.0.0.1:1025` | Captura local de todos los correos enviados en desarrollo (invitaciones, reseteos de contraseña, avisos de liquidación y pagos) sin enviar emails reales. |
| `minio` | `rancher/mirrored-minio-minio:RELEASE.2023-07-07T07-13-57Z` | `9000` (API S3)<br>`9001` (Consola) | Consola web: `http://localhost:9001`<br>API S3: `http://localhost:9000` | Almacenamiento de objetos compatible con S3 (emula Cloudflare R2 en local para comprobantes y PDFs). Se usa el mirror oficial multi-arch de Rancher con tag `RELEASE.*` fijo porque los repositorios públicos `minio/minio` y `minio/mc` fueron retirados de Docker Hub. |
| `minio-init` | `rancher/mirrored-minio-mc:RELEASE.2023-06-28T21-54-17Z` | — | Servicio de inicialización (`exited 0`) | Espera a que `minio` esté saludable, crea el bucket `comprobantes` si no existe y configura su política anónima en `none` (privado). |
| `web` | Build local (`backend/Dockerfile.dev`) | `8000` → `8000` | `http://localhost:8000` (panel en `/panel`, portal en `/portal`, logins en `/ingresar`) | Aplicación Django en modo desarrollo (`runserver`) con recarga en vivo, montaje de `./backend` y del front `./design`. |

## Cómo arrancar de cero

1. **Crear el archivo de variables de entorno local:**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Ajustá `SECRET_KEY` y las credenciales de ejemplo (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`) en `backend/.env` si fuera necesario.

2. **Levantar los servicios:**
   ```bash
   make up
   # equivalente a: docker compose up -d
   ```

3. **Aplicar las migraciones:**
   ```bash
   make migrate
   # equivalente a: docker compose run --rm web python manage.py migrate
   ```

4. **Cargar los datos de demostración (opcional, sobre base vacía):**
   ```bash
   make seed DEMO_PASSWORD=una_clave_de_al_menos_10_caracteres
   ```

   `make seed` también corre `seed_demo_files`, que sube a MinIO una imagen o PDF de ejemplo para cada comprobante de la demo (solo con `DEBUG=True`).

   **Almacenamiento (D1/D4):** `web` habla con MinIO en `http://minio:9000` (`S3_ENDPOINT_URL`) y firma las URLs del navegador contra `http://localhost:9000` (`S3_PUBLIC_ENDPOINT_URL`). Las credenciales salen de `MINIO_ROOT_*`. Los comprobantes van a `receipts/<organización>/<uuid>` y los PDF de liquidación a `settlements/…`. Para borrar subidas huérfanas: `make cleanup-uploads` (cuando exista el worker de D2, lo hará `celery beat`).

5. **Ejecutar la suite de tests (con base de tests limpia):**
   ```bash
   make test
   ```

6. **Reiniciar la base de datos desde cero (borra volúmenes locales):**
   ```bash
   make reset-db
   # equivalente a: docker compose down -v
   ```

## Diferencia entre la imagen de desarrollo y la de producción

| Aspecto | Desarrollo (`backend/Dockerfile.dev`) | Producción (`backend/Dockerfile`) |
|---|---|---|
| **Construcción** | Una sola etapa (`python:3.12-slim`) con compiladores (`gcc`, `libpq-dev`) presentes en la imagen. | **Multi-stage**: la etapa `builder` compila e instala en `/opt/venv` con `gcc` y `libpq-dev`; la etapa final `runtime` solo instala `libpq5` (sin compiladores). |
| **Dependencias** | `requirements/development.txt` (incluye `pytest`, `factory-boy`, `ipython`, `coverage`, etc.). | `requirements/production.txt` (`base.txt` + `gunicorn` y `whitenoise`, sin herramientas de test o debug). |
| **Usuario de ejecución** | `root` (para facilitar el montaje del volumen local `./backend:/app`). | Usuario sin privilegios `app` (`UID 10001`, `GID 10001`, shell `/usr/sbin/nologin`). |
| **Permisos de archivos** | Escritura completa sobre `/app` montado desde el host. | Código en `/app` perteneciente a `root:root` y de **solo lectura** para `app` (`chmod -R go-w,a+rX /app`), salvo `/app/staticfiles` perteneciente a `app:app`. |
| **Código y `.env`** | Se monta `./backend` como volumen y Compose inyecta `backend/.env`. | Código copiado en build; `.dockerignore` excluye `.env*`, `__pycache__`, `.pytest_cache` y reportes de cobertura. |
| **Front (`design/`, ADR-0002)** | Se monta `./design` en `/design` (solo lectura): los cambios en el HTML/JS se ven al recargar. | Se copia `design/` a `/design` (sin `design/ref/` ni `DISENO.md`). El contexto de build es la **raíz del repo** (`.dockerignore` de la raíz). |
| **Servidor WSGI** | `python manage.py runserver 0.0.0.0:8000` (definido en `docker-compose.yml`). | `gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-2} --access-logfile -`. |
| **Archivos estáticos (`collectstatic`)** | Servidos directamente por Django en `DEBUG=True`; `design/assets/` se publica en `/static/assets/`. | No se corre `collectstatic` durante el `docker build` porque requiere las variables de entorno de producción; debe ejecutarse en el arranque/release del contenedor (`python manage.py collectstatic --noinput`) antes o al iniciar el servicio. |
| **Healthcheck** | Sin `HEALTHCHECK` en imagen. | `HEALTHCHECK` TCP liviano en el puerto `8000` (hasta que se incorpore el endpoint `/health` en E5). |

Para construir y probar localmente la imagen de producción:

```bash
make build-prod
# equivalente a (desde la raíz del repo): docker build -f backend/Dockerfile -t gc-web:prod .
```
