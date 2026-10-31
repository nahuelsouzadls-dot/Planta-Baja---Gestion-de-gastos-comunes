# Administración GC

Sistema de gestión para edificios de propiedad horizontal. Digitaliza el trabajo de administradoras que hoy operan con Excel y papel.

## Qué hace

- Carga mensual de gastos del edificio (OSE, UTE, limpieza, honorarios, fondo de reserva)
- Prorrateo automático por coeficiente de copropiedad
- Generación de liquidaciones individuales por apartamento en PDF
- Portal para residentes: ver liquidaciones, subir comprobante de pago
- Panel de administración: validar pagos, ver morosos, publicar avisos
- Comunicaciones bidireccionales entre administración y residentes

## Stack

- **Backend:** Python 3.12 + Django 5.x + Django REST Framework
- **Base de datos:** PostgreSQL 16
- **Infraestructura:** Docker Compose (desarrollo) · Railway (producción)

## Estructura

```
administracion-gc/
├── backend/          # Django — modelos, API REST, seed data
│   ├── apps/
│   │   ├── core/        # UUIDs, timestamps y extensiones de PostgreSQL
│   │   └── accounts/    # Usuarios, organizaciones y membresías
│   └── config/          # Settings, URLs, WSGI
├── frontend/         # App React (panel, portal y logins) — Vite + Tailwind + shadcn/ui
├── design/           # Referencia del diseño aprobado (DISENO.md, ref/)
├── docker-compose.yml
└── CLAUDE.md         # Contexto del proyecto para desarrollo con IA
```

## Correr el backend en local

Requisitos: Docker (Docker Desktop, u OrbStack/Colima en macOS) y Node 22.

```bash
cp backend/.env.example backend/.env   # y completar SECRET_KEY y MINIO_ROOT_* (ver docs/docker.md)
make front-install && make front-build # compila el front (React) que sirve Django
make up
make migrate
make seed DEMO_PASSWORD=una_clave_de_al_menos_10_caracteres
make test
```

El servidor queda en `http://localhost:8000` (panel en `/panel`, portal en `/portal`).
Detalle de servicios, puertos y cómo trabajar desde varias máquinas: [`docs/docker.md`](docs/docker.md).

### Front con recarga en vivo

```bash
make front-dev   # http://localhost:5173 (le pasa /api a Django en :8000)
```

El front es una app React + Vite + shadcn/ui en `frontend/` (ADR-0018). Las reglas visuales
del cliente están en `design/DISENO.md`. El Django admin queda en `http://localhost:8000/admin`.

## Caso de uso inicial

**Confort S.A.** — administradora de un edificio de 12 apartamentos en Montevideo, Uruguay. Opera con Scotiabank para el cobro de expensas.

## Licencia

Material propietario, publicado solo con fines de evaluación. Ver [`LICENSE`](LICENSE).
