# Guía de Roles de Agentes

> **Flujo de trabajo:** GitHub Copilot escribe el código; Claude (y sus agentes) solo da guías, especificaciones, prompts y revisiones. Las reglas que Copilot carga automáticamente están en `.github/copilot-instructions.md`.

## Punto de entrada: siempre el Arquitecto

**No invocás los agentes directamente.** Abrís Claude Code, cargás `agent-arquitecto.md`, y él coordina todo lo demás. El Arquitecto lee el estado del proyecto, te hace las preguntas necesarias, y él solo invoca a los otros agentes usando la herramienta `Agent`.

```
Vos  ──────────────────────────►  Arquitecto
                                      │
                    ┌─────────────────┼──────────────────┐
                    ▼                 ▼                   ▼
               Guía Copilot        Tutor              Diseñador
               (agent-guia-copilot.md)  (agent-tutor.md)  (agent-disenador.md)
                                                           │
                                                      Revisor
                                                 (agent-revisor.md)
```

---

## Los 5 Agentes

| Agente | Archivo | Quién lo invoca | Para qué |
|---|---|---|---|
| **Arquitecto** | `agent-arquitecto.md` | **Vos** (siempre, al inicio) | Orquesta todo, toma decisiones, coordina el flujo |
| **Tutor** | `agent-tutor.md` | Arquitecto (o vos directamente) | Explicar conceptos, enseñar el por qué detrás del código |
| **Guía Copilot** | `agent-guia-copilot.md` | Arquitecto | Escribir guías y prompts para que Nahuel implemente con Copilot (no escribe código) |
| **Diseñador** | `agent-disenador.md` | Arquitecto | Wireframes, flujos UX, especificación de pantallas |
| **Revisor** | `agent-revisor.md` | Arquitecto (automático al terminar una feature) | Auditar código antes de continuar |

---

## Cómo arrancar una sesión de trabajo

1. Abrís Claude Code en la carpeta del proyecto (`/orca/administracion-gc`)
2. Cargás `agent-arquitecto.md` como contexto
3. Le decís qué querés trabajar hoy (o le preguntás qué viene después)
4. Él lee el estado del repo, hace preguntas si las hay, y arranca

Eso es todo. El resto lo coordina él.

---

## Cuándo sí invocás un agente directamente (sin pasar por el Arquitecto)

Solo en estos casos:

| Situación | Agente directo |
|---|---|
| Tenés una duda puntual de concepto y no querés abrir sesión completa | **Tutor** |
| Querés revisar un snippet de código que acabás de escribir vos | **Revisor** |

Para cualquier cosa que implique avanzar en el desarrollo, pasá por el Arquitecto.

---

## Flujo que sigue el Arquitecto internamente

Para cada feature, el Arquitecto sigue este orden. Puede saltear pasos para features simples.

```
1. Clarificación   → pregunta a Nahuel qué quiere lograr
2. Decisiones      → resuelve pendientes de arquitectura antes de arrancar
3. Tutor           → explica el concepto si Nahuel lo necesita
4. Diseñador       → define la pantalla si tiene UI
5. Guía Copilot    → escribe la guía de implementación y los prompts
6. Nahuel+Copilot  → implementan el código en el editor
7. Tutor           → explica partes del código si Nahuel lo pide
8. Revisor         → audita el código antes de pasar al siguiente feature
9. Resumen         → documenta qué se hizo y qué sigue
```

---

## Agentes que se agregan en fases siguientes

| Agente | Cuándo |
|---|---|
| **Redactor de Tests** | Fase 2 — cuando empiece la lógica del prorrateo y el ledger |
| **DevOps / Infra** | Fase 4 — cuando haya que configurar Docker, CI/CD, deploy a Render/Railway |
| **Migrador de Datos** | Fase 4 — para importar los saldos iniciales desde el Excel de Confort S.A. |
| **Documentador** | Post-MVP — para generar manuales de usuario para Confort S.A. |
