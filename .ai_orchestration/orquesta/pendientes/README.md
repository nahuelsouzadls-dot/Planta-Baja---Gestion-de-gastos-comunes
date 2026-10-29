# Tareas pendientes, en orden

Escritas por Claude el 2026-10-24, mientras Copilot (cuota mensual) y agy (cuota individual, vuelve ~2026-10-30) no podían trabajar. Cada archivo es una tarea completa: para despacharla, copiarla a `tareas/<agente>.md` y crear `ordenes/<agente>`.

| Orden | Tarea | Depende de | Archivos principales | Notas |
|---|---|---|---|---|
| 1 | ~~`D1a.md` + `D1b.md`~~ — **hechas por Claude (2026-10-24)** | C3c | `backend/apps/storage/` | Falta el test `@pytest.mark.minio` contra MinIO real (se probó a mano en el navegador) |
| 2 | ~~`C4a.md`~~ — **hecha por Claude (2026-10-24, excepción al flujo pedida por Nahuel)** | D1 (para subir comprobante) | `backend/apps/frontend/`, `design/assets/api.js`, logins, Dockerfile | Toca `design/` |
| 3 | ~~`C4b.md`~~ — **hecha por Claude (2026-10-24)** | C4a | `design/assets/admin*.js` | |
| 4 | ~~`C4c.md`~~ — **hecha por Claude (2026-10-24), salvo subir comprobante (espera D1)** | C4a, D1 | `design/assets/portal.js` | |
| 5 | `D2.md` — Celery + Redis | — (puede ir en paralelo a C4) | `backend/config/celery.py`, `worker` en compose | |
| 6 | `D3.md` — emails (Mailpit / proveedor) | D2 | `backend/apps/notifications/` | |
| 7 | ~~`D4.md`~~ — **hecha por Claude (2026-10-24): se genera a pedido**; generarlo al emitir queda para D2 | D2, D1 | `backend/apps/documents/` | Requisito duro del cliente |
| 8 | ~~`D5.md`~~ — **hecha por Claude (2026-10-24)** | — | `backend/apps/documents/` | Requisito duro del cliente |
| 9 | `E2.md` — roles de base separados | — | compose, scripts de Postgres, settings | Cambia cómo se corren los tests |
| 10 | `E4.md` — carga del día cero de Confort | — | `backend/apps/onboarding/` | Necesita la planilla real de Confort |
| 11 | `E5.md` — salud, logs y errores | — | `backend/apps/core/` | |
| 12 | `SEC4.md` — sacar las credenciales del `docker-compose.yml` a `backend/.env` | coordinar con E2 | `docker-compose.yml`, `Makefile`, `backend/.env.example`, CI | Pedido de Nahuel (2026-10-28); obliga a `make reset-db` en cada máquina |
| 13 | `E6.md` — deploy en Railway | todo lo anterior | `railway.json` / docs | Requiere cuentas y decisiones de Nahuel |
| 14 | `H1.md` — buscador de movimientos de toda la cartera (Historial) | — | `backend/apps/api/v1/panel.py`, tests | Pedido de Nahuel (2026-10-28); el front de Historial ya existe |
| 15 | `R1.md` — roles del equipo (titular, administrativo, solo lectura) y pantalla Equipo | — | `backend/apps/accounts/`, `api/v1/panel.py`, front `panel/` | Pedido de Nahuel (2026-10-28); base ahora, forma final de roles con el piloto |
| 16 | `A1.md` — backoffice del dueño del SaaS (etapa 1: comando de alta + admin de Django; etapas 2 y 3 diseñadas) | R1 | `backend/apps/accounts/`, `admin.py`, más adelante `frontend/` | Pedido de Nahuel (2026-10-28) |
| 17 | `B1.md` — Ayuda ("?") con manual interno y buscador "Buscar o preguntar" sin IA | H1 (opcional) | `frontend/src/features/help/`, `api/v1/search.py` | Pedido de Nahuel (2026-10-28); manual en `frontend/src/features/help/manual.md` |
| 18 | `S1.md` — reservas de espacios comunes (portal + Agenda del panel) | un cliente que lo pida | `backend/apps/` (nueva app), portal, panel | Idea de Nahuel (2026-10-28); reglas según reglamento de cada edificio |
| 19 | `I1.md` — invitación por código (activación del residente): backend | — | `backend/apps/accounts/`, `invitations/`, `api/v1/panel.py` | Pedido de Nahuel (2026-10-28); el **front ya está hecho** (código→unidad→contraseña→instalar app); falta disparar/validar el código y asociar persona↔unidad |

Antes de abrir a residentes reales: revisión de seguridad independiente de todo lo nuevo (como `docs/auditorias/`), texto de privacidad (Ley 18.331) y piloto con la administración (`docs/plan-mvp.md`, sección F).
> Formato O-A-R-S (ver ../README.md). Las pendientes viejas se convierten al despacharlas.

**C4 (2026-10-24):** el front quedó conectado a la API. Lo hizo Claude a pedido de Nahuel, fuera del flujo Copilot. Falta revisarlo y commitearlo. Pendientes que dependen de otras tareas: subir comprobante en el portal y "Ver comprobante" con la imagen (D1), PDF de la liquidación (D4), Excel desde el backend (D5; hoy el panel exporta un CSV con los datos de la API). Las pantallas de pagos manuales, ajustes y ocupantes no existen en el diseño, así que esos endpoints de C3b no tienen botón.

**D1, D4, D5 y el resto de C4 (2026-10-24, Claude, sin commitear):** subir y ver comprobantes (MinIO en Docker, R2 en producción con CORS para POST y GET desde el dominio del front), PDF de liquidación de edificio y de unidad (inmutables, a pedido), Excel de cobros, cuenta corriente y liquidación, y en la ficha de unidad del panel: pago sin comprobante, ajuste y ocupantes. Para D2 quedan: generar los PDF al emitir, la tarea periódica `cleanup_orphan_uploads` (hoy `make cleanup-uploads`) y los emails.
