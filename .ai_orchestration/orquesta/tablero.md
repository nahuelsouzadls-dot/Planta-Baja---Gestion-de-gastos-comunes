# Tablero

Objetivo actual: **backend v1 según `docs/modelo-datos.md`** (microtareas B0–B9), y en paralelo agy extrae los valores de referencia del front para los tests.

Base de diseño vigente: **front final** en `main` (`cc95571` + `e60d4fe`). Admin y portal generan el HTML de los prototipos de `design/ref/` y usan su CSS (`design/assets/admin.css`, `design/assets/portal.css`); la lógica vive en `core.js`, `data.js` y `ledger.js`. Reglas del cliente en `design/DISENO.md`.

Los rediseños anteriores (crm-look, redesign-corporate, glass-ui, tokens.css/ui.css) quedaron deprecados y sus tareas y reportes se borraron.

| Agente | Herramienta | Tarea | Archivos | Estado |
|---|---|---|---|---|
| auditor | agy | golden-front — valores de referencia | `docs/golden/` | 🟡 orden dada |
| implementador | copilot | B0 — reset y bases | `backend/`, `docker-compose.yml`, `README.md` | 🟡 orden dada |

## Cómo se reparten los agentes
Un agente por **área**, no por pantalla. Cuando arranque el backend se suma otro agente (por ejemplo, `backend`) con sus propios archivos.
