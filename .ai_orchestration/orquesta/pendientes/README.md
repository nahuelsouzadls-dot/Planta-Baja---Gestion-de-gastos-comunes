# Tareas pendientes, en orden

Escritas por Claude el 2026-10-24, mientras Copilot (cuota mensual) y agy (cuota individual, vuelve ~2026-10-30) no podían trabajar. Cada archivo es una tarea completa: para despacharla, copiarla a `tareas/<agente>.md` y crear `ordenes/<agente>`.

| Orden | Tarea | Depende de | Archivos principales | Notas |
|---|---|---|---|---|
| 1 | `D1.md` — comprobantes en S3 (MinIO/R2) | C3c | `backend/apps/storage/` | Ya estaba despachada a agy; no arrancó por la cuota |
| 2 | `C4a.md` — servir el front y conectar la sesión | D1 (para subir comprobante) | `backend/apps/frontend/`, `design/assets/api.js`, logins, Dockerfile | Toca `design/` |
| 3 | `C4b.md` — panel conectado a la API | C4a | `design/assets/admin*.js` | |
| 4 | `C4c.md` — portal conectado a la API | C4a, D1 | `design/assets/portal.js` | |
| 5 | `D2.md` — Celery + Redis | — (puede ir en paralelo a C4) | `backend/config/celery.py`, `worker` en compose | |
| 6 | `D3.md` — emails (Mailpit / proveedor) | D2 | `backend/apps/notifications/` | |
| 7 | `D4.md` — PDF de la liquidación | D2, D1 | `backend/apps/documents/` | Requisito duro del cliente |
| 8 | `D5.md` — exportar a Excel | — | `backend/apps/documents/` | Requisito duro del cliente |
| 9 | `E2.md` — roles de base separados | — | compose, scripts de Postgres, settings | Cambia cómo se corren los tests |
| 10 | `E4.md` — carga del día cero de Confort | — | `backend/apps/onboarding/` | Necesita la planilla real de Confort |
| 11 | `E5.md` — salud, logs y errores | — | `backend/apps/core/` | |
| 12 | `E6.md` — deploy en Railway | todo lo anterior | `railway.json` / docs | Requiere cuentas y decisiones de Nahuel |

Antes de abrir a residentes reales: revisión de seguridad independiente de todo lo nuevo (como `docs/auditorias/`), texto de privacidad (Ley 18.331) y piloto con la administración (`docs/plan-mvp.md`, sección F).
