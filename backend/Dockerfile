# syntax=docker/dockerfile:1
# Se construye desde la raíz del repo: docker build -f backend/Dockerfile .

# ==============================================================================
# Etapa 1: builder — compila dependencias en un virtualenv aislado
# ==============================================================================
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY backend/requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/production.txt

# ==============================================================================
# Etapa 2: front — compila la app React (ADR-0018) a archivos estáticos
# ==============================================================================
FROM node:22-slim AS front

WORKDIR /front
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Etapa 3: runtime — solo librería cliente de PostgreSQL y usuario sin privilegios
# ==============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    GUNICORN_WORKERS=2

# libpango/harfbuzz y una fuente: WeasyPrint (PDF de la liquidación, D4).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# El código de la aplicación y el build del front (ADR-0018) pertenecen a root y son de
# solo lectura para el usuario `app`. El contexto de build es la raíz del repo.
COPY --chown=root:root backend/ /app
COPY --from=front --chown=root:root /front/dist /frontend/dist
RUN chmod -R go-w,a+rX /app /frontend \
    && mkdir -p /app/staticfiles \
    && chown app:app /app/staticfiles

# NOTA DE ARRANQUE (producción):
# `collectstatic` NO se ejecuta durante el build porque `config.settings.production`
# exige variables de entorno de producción (SECRET_KEY fuerte, ALLOWED_HOSTS, DB_*).
# Ejecutar en el comando de release/arranque del contenedor con esas variables definidas:
#   python manage.py collectstatic --noinput
#   python manage.py migrate --noinput

USER app

EXPOSE 8000

# Healthcheck liviano de nivel TCP hasta que llegue el endpoint de salud en E5.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import socket; s = socket.create_connection(('127.0.0.1', 8000), timeout=3); s.close()"

CMD ["sh", "-c", "exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-2} --access-logfile -"]
