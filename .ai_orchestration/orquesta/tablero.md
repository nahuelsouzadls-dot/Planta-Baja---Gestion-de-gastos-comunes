# Tablero

Objetivo actual: **auditar el diseño final del front.**

Base de diseño vigente: **front final** en `main` (`cc95571` + `e60d4fe`). Admin y portal generan el HTML de los prototipos de `design/ref/` y usan su CSS (`design/assets/admin.css`, `design/assets/portal.css`); la lógica vive en `core.js`, `data.js` y `ledger.js`. Reglas del cliente en `design/DISENO.md`.

Los rediseños anteriores (crm-look, redesign-corporate, glass-ui, tokens.css/ui.css) quedaron deprecados y sus tareas y reportes se borraron.

| Agente | Herramienta | Tarea | Archivos | Estado |
|---|---|---|---|---|
| auditor | agy | audit-front-final | ninguno (solo lectura) | 🟡 orden dada |

## Cómo se reparten los agentes
Un agente por **área**, no por pantalla. Cuando arranque el backend se suma otro agente (por ejemplo, `backend`) con sus propios archivos.
