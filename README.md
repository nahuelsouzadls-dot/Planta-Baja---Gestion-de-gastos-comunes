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
│   │   ├── buildings/   # Edificios y apartamentos
│   │   ├── residents/   # Residentes (propietarios e inquilinos)
│   │   ├── expenses/    # Gastos mensuales
│   │   └── ledger/      # Libro mayor (movimientos financieros)
│   └── config/          # Settings, URLs, WSGI
├── design/           # Mockups HTML del panel admin y portal residente
├── docker-compose.yml
└── CLAUDE.md         # Contexto del proyecto para desarrollo con IA
```

## Correr en local

```bash
# Levantar base de datos y servidor
docker compose up

# En otra terminal, aplicar migraciones y cargar datos de prueba
docker compose exec web python manage.py migrate
docker compose exec web python manage.py seed_data
```

El servidor queda en `http://localhost:8000`.
El panel de Django admin en `http://localhost:8000/admin`.

## Caso de uso inicial

**Confort S.A.** — administradora de un edificio de 12 apartamentos en Montevideo, Uruguay. Opera con Scotiabank para el cobro de expensas.
