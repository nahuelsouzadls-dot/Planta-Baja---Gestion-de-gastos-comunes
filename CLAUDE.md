# CLAUDE.md — Sistema de Gestión de Propiedad Horizontal

Este archivo da contexto a Claude Code sobre el proyecto. Léelo completo antes de cualquier tarea.

**Para trabajar en el proyecto: cargá `.ai_orchestration/roles/agent-arquitecto.md` como punto de entrada. Él orquesta a los demás agentes.**

## Flujo de trabajo: Copilot codea, Claude guía

- **Claude no escribe código.** Nada en `backend/` (modelos, vistas, templates, tests, migraciones) ni en `design/` (los mockups HTML/CSS también los hace Copilot).
- **Claude se reserva al diseño:** arquitectura, modelo de datos, flujos, UX y especificaciones de pantallas (wireframes en texto), más las guías y prompts para Copilot y la revisión del código resultante.
- **Nahuel implementa con GitHub Copilot.** Las reglas del proyecto que Copilot carga automáticamente están en `.github/copilot-instructions.md`; mantenelo sincronizado con las decisiones de este archivo.
- Claude sí puede editar documentación (`*.md`, `.ai_orchestration/`, `.github/copilot-instructions.md`).
- Si Nahuel pide explícitamente que Claude escriba código en un caso puntual, se hace avisando que se sale del flujo.

---

## Qué es este proyecto

SaaS B2B para digitalizar la gestión de consorcios/edificios de propiedad horizontal.
El caso de uso inicial es **Confort S.A.**, administradora de un edificio de **12 apartamentos, 3 pisos, Montevideo, Uruguay**, que hoy opera con Excel y papel.

**Modelo de negocio:** suscripción mensual fija cobrada a la administración. Infraestructura absorbida por el desarrollador en el MVP.

---

## Documentos clave del proyecto

| Archivo | Contenido |
|---|---|
| `.ai_orchestration/plans/arquitectura.md` | Blueprint arquitectónico original (scope, stack, DER, flujos críticos) |
| `.ai_orchestration/roles/agents.md` | System prompt del agente Auditor Técnico (Staff Architect) |
| Claude Doc (PRD Extendido) | Especificaciones ampliadas: personas, auditoría, diagramas Mermaid, roadmap. Ver link abajo. |

**PRD Extendido (Claude Doc):** https://claude.ai/code/artifact/411c37f5-de14-4dd1-9956-2ae70007e36c

---

## Usuarios y roles

| Rol | Quién es | Responsabilidad |
|---|---|---|
| **Administración** | Confort S.A. | Ingresa gastos, valida comprobantes de pago (Scotiabank), genera reportes de morosos y PDFs |
| **Residente Inquilino** | Locatario del apartamento | Paga gastos comunes ordinarios; tiene cuenta corriente propia |
| **Residente Propietario** | Dueño del apartamento | Paga Fondo de Reserva y Cuotas Extraordinarias; si no hay inquilino, asume todos los gastos |

---

## Stack — DECISIÓN PENDIENTE DE CONFIRMAR

Hay una tensión entre el blueprint original y el PRD extendido. Antes de escribir código, confirmar con el usuario cuál es el stack elegido:

### Opción A — Blueprint original (`arquitectura.md`)
- **Backend:** Python + Django (con panel de admin nativo para Confort S.A.)
- **BD:** PostgreSQL
- **Storage:** Cloudflare R2 o Supabase Storage
- **Async:** Celery + Redis (PDFs, emails masivos)
- **Infra:** Render o DigitalOcean con Docker
- **Email:** Resend o Brevo

### Opción B — PRD Extendido (Claude Doc, Sección 4)
- **Backend:** Node.js 22 LTS + TypeScript + Fastify 4.x
- **ORM:** Prisma 5.x
- **BD:** PostgreSQL 16 (con RLS)
- **Frontend:** Next.js 14 (App Router) + shadcn/ui + Tailwind
- **Auth:** NextAuth.js v5
- **Storage:** Cloudflare R2
- **Infra:** Vercel (frontend) + Railway (API) + Neon (PostgreSQL serverless)
- **Email:** Resend

**Contexto:** Django ofrece el panel de admin nativo que puede servir directamente a Confort S.A. sin construir un frontend de admin. Node/TypeScript es más flexible para portal de residentes con mejor DX. Una opción intermedia es Django para el panel admin + API REST, y Next.js solo para el portal de residentes.

---

## Decisiones arquitectónicas confirmadas (independientes del stack)

1. **Ledger append-only:** los movimientos financieros son inmutables — nunca UPDATE/DELETE sobre ellos. Cada corrección es un asiento nuevo.
2. **PKs UUID:** no enteros seriales, para evitar enumeración de recursos y facilitar sharding futuro.
3. **Coeficiente de copropiedad:** campo `Decimal` (no `Float`) en cada apartamento. El prorrateo se calcula en el backend, no en el cliente.
4. **Validación manual de pagos:** el residente sube comprobante → queda en `Pendiente` → admin valida contra su cuenta bancaria → pasa a `Completado`. No hay auto-validación en el MVP.
5. **Migración día cero:** no se migra histórico de Excel. Se crea un asiento de apertura con saldos consolidados a una fecha de corte.
6. **Contingencia analógica:** exportación a Excel y PDF siempre disponible (requerimiento duro del cliente para residentes mayores).
7. **Multi-tenant por edificio:** el `building_id` es la raíz de aislamiento. Un usuario de un edificio nunca debe ver datos de otro.
8. **Upload directo a storage:** los archivos nunca pasan por el servidor de aplicación — presigned URLs desde R2/S3.

---

## Contexto del cliente (Uruguay)

- Moneda: **UYU (pesos uruguayos)**
- Banco del cliente: **Scotiabank Uruguay** (validación manual de transferencias)
- Marco legal: **Ley 10.751 de Propiedad Horizontal (Uruguay)** — no aplica la Ley 13.512 de Argentina
- Servicios en la liquidación: O.S.E (agua), U.T.E (luz), Limpieza, Honorarios, Cuotas Extraordinarias, Fondo de Reserva
- El cliente actual tiene **1 edificio, 12 apartamentos**. El MVP debe soportar multi-edificio desde el diseño aunque se opere con uno solo.

---

## Scope del MVP (12 semanas estimadas)

| Fase | Semanas | Entregables |
|---|---|---|
| 0 — Fundaciones | 1–2 | Repo, CI/CD, auth, multi-tenant base |
| 1 — Gestión de entidades | 3–5 | Edificios, apartamentos, residentes |
| 2 — Expensas y liquidaciones | 6–8 | Carga de gastos, prorrateo, PDF, notificación |
| 3 — Pagos y ledger | 9–10 | Subida de comprobante, validación manual, ledger |
| 4 — Portal y piloto | 11–12 | Dashboard residente, exportación, onboarding Confort S.A. |

---

## Estructura del repositorio (proyectada)

```
administracion-gc/
├── CLAUDE.md           ← este archivo
├── arquitectura.md     ← blueprint original
├── agents.md           ← system prompt auditor técnico
├── .github/copilot-instructions.md ← reglas que Copilot carga automáticamente
├── backend/            ← por crear (Django o Fastify según decisión de stack)
├── frontend/           ← por crear (Next.js, si se elige Opción B)
└── docs/               ← diagramas adicionales, ADRs
```

---

## Decisiones confirmadas

- **Stack:** Python 3.12 + Django 5.x + PostgreSQL 16 + Celery + Redis + Cloudflare R2 ✅
- **Deploy:** Railway ✅
- **Front:** cerrado en `design/` (admin, portal y logins; CSS de los prototipos de `design/ref/`). Reglas del cliente en `design/DISENO.md`. ✅
- **Modelo de datos del backend:** aprobado en `docs/modelo-datos.md`; arquitectura, UML y ADR en `docs/`. Se implementa en microtareas B0–B9. ✅

## Lo que NO está decidido aún

- Nombre comercial del producto
- Precio de la suscripción mensual
- Portal de residentes: propuesta en `docs/adr/0002-front-estatico-js-puro.md` (servir el front actual como estático y que consuma la API); falta el ok de Nahuel.
- Estrategia de onboarding para residentes mayores (considerando baja tech literacy)
