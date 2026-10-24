# ADR-0001: Stack: Django + PostgreSQL + Celery + R2 en Railway

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
El MVP necesita un panel de administración, un portal de residentes, cálculos financieros exactos, tareas en segundo plano (PDFs, emails) y archivos. Hubo dos propuestas: Django (blueprint original) y Node/Fastify + Next.js (PRD extendido).

## Decisión
Python 3.12, Django 5 y Django REST Framework; PostgreSQL 16; Celery con Redis; Cloudflare R2 para archivos; deploy en Railway.

## Alternativas descartadas
- Node 22 + Fastify + Prisma + Next.js: mejor experiencia de desarrollo en el front, pero hay que construir a mano el admin, las migraciones con restricciones avanzadas y el manejo de `Decimal`.
- Supabase: rápido de arrancar, pero ata la lógica de negocio a RLS y funciones de la plataforma.

## Consecuencias
- El admin de Django sirve como herramienta interna de soporte desde el primer día.
- `Decimal` y las restricciones de Postgres (`EXCLUDE`, triggers) se usan de forma nativa.
- Un solo lenguaje en el backend; el front sigue siendo JS puro ([ADR-0002](0002-front-estatico-js-puro.md)).
