# Tablero

Objetivo actual: **API (plan C de `docs/plan-mvp.md`)**; en paralelo, CI (E3).

Base de diseño vigente: **front final** en `main` (`cc95571` + `e60d4fe`). Admin y portal generan el HTML de los prototipos de `design/ref/` y usan su CSS (`design/assets/admin.css`, `design/assets/portal.css`); la lógica vive en `core.js`, `data.js` y `ledger.js`. Reglas del cliente en `design/DISENO.md`.

Los rediseños anteriores (crm-look, redesign-corporate, glass-ui, tokens.css/ui.css) quedaron deprecados y sus tareas y reportes se borraron.

| Agente | Herramienta | Tarea | Archivos | Estado |
|---|---|---|---|---|
| auditor | agy | E3 — CI en GitHub Actions | `.github/workflows/ci.yml`, `docs/ci.md` | 🟡 orden dada |
| implementador | copilot | C1 — API de sesión e invitaciones | `backend/apps/api/`, `backend/apps/accounts/`, settings, urls | 🟡 orden dada |

## Cómo se reparten los agentes
Un agente por **área**, no por pantalla. Cuando arranque el backend se suma otro agente (por ejemplo, `backend`) con sus propios archivos.
