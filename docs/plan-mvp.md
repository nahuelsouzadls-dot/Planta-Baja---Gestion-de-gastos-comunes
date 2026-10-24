# Plan hasta el MVP

Estado al 2026-10-24: **el modelo de datos está terminado** (B0–B9) y pasó dos revisiones de seguridad independientes (SEC1, SEC2). La demo cargada en PostgreSQL da los mismos números que el front. El front está cerrado (`design/`) y se conecta por API (ADR-0002).

"MVP" = Confort S.A. puede operar Edificio Minas de verdad: cargar y emitir el mes, que los residentes vean su cuenta y suban comprobantes, validarlos, imprimir y exportar, y que corra en Docker igual que en Railway.

## Lo que falta, en orden

### C — API y conexión del front
| # | Microtarea | Qué entrega |
|---|---|---|
| C1 | **Login, logout e invitaciones** | Endpoints de sesión (login por email, logout, "quién soy" con sus organizaciones y personas), invitación de empleados y residentes por email con link de un solo uso, aceptar invitación y definir contraseña, **recuperar contraseña**. Los logins `gc-login-*.html` pasan a funcionar. |
| C2 | **Permisos y alcance** | Clases de permiso de DRF: empleado de la organización / residente de la ocupación (con la regla del ex inquilino, N17). Un mixin de alcance que filtra todo por organización u ocupaciones. Test de "otra organización → 404" obligatorio por endpoint. |
| C3a | **API del panel: lectura** | Cartera (`portfolio_totals`), edificio (cobros, resumen, gastos, comunicaciones), ficha de unidad, cola de comprobantes, tareas. Montos como strings. Pocas consultas por pantalla. |
| C3b | **API del panel: escritura** | Cargar y emitir gastos, aprobar y rechazar comprobantes, pagos manuales, ajustes, ocupantes (B2b), avisos, reclamos, tareas. Cada endpoint llama a su servicio. |
| C3c | **API del portal** | Mi cuenta (estado, liquidación por mes, movimientos), mis comprobantes, subir comprobante, avisos, reclamos. |
| C4 | **Conectar el front** | `GC.store` deja `localStorage` y usa la API; manejo de sesión vencida, errores y CSRF; los logins redirigen según el rol. Las pantallas no cambian. |

### D — Archivos, PDF, emails y exportación
| # | Microtarea | Qué entrega |
|---|---|---|
| D1 | **Comprobantes en almacenamiento S3** | URLs firmadas para subir y ver; verificación de tipo, tamaño y sha256. En Docker, **MinIO** (compatible con S3); en producción, Cloudflare R2. Mismo código. |
| D2 | **Celery + Redis** | Worker y cola en Docker; tareas idempotentes encoladas con `on_commit`. |
| D3 | **Emails** | Invitaciones, recuperar contraseña, "se emitió la liquidación", "tu pago fue validado/rechazado". En Docker, **Mailpit** (ves los emails en el navegador sin mandar nada real); en producción, Resend o Brevo. |
| D4 | **PDF de la liquidación** | Por edificio y por residente, generado en el worker y guardado en el almacenamiento. Requisito duro del cliente (residentes mayores). |
| D5 | **Exportar a Excel** | Cobros del edificio y cuenta corriente, desde el backend (hoy el front genera un CSV local). |

### E — Puesta en marcha
| # | Microtarea | Qué entrega |
|---|---|---|
| E1 | **Docker "como producción"** | `Dockerfile` de producción (multi-stage, usuario sin privilegios, gunicorn, whitenoise sirviendo el front), `docker-compose.yml` completo: `db`, `redis`, `web`, `worker`, `minio`, `mailpit`. Healthchecks. Un `make` o script con los comandos de siempre. |
| E2 | **Roles de base separados** | `gc_owner` (migraciones) y `gc_app` (la app, sin poder apagar triggers ni hacer `TRUNCATE`), como exige `almacenamiento.md` §2. |
| E3 | **CI** | GitHub Actions: tests con PostgreSQL en cada push y en cada PR; `makemigrations --check`; `check --deploy`. |
| E4 | **Carga inicial de Confort (día cero)** | Comando para importar desde una planilla: edificio, unidades con coeficientes, personas, ocupaciones y **saldos de apertura** a la fecha de corte (ADR-0014). Con un modo "simular" que muestra qué haría sin escribir. |
| E5 | **Observabilidad mínima** | Endpoint de salud, logs estructurados sin datos personales, captura de errores (Sentry, opcional). |
| E6 | **Deploy en Railway** | `web` y `worker`, Postgres y Redis administrados, R2, variables de entorno, backups y **una restauración de prueba** antes de abrir. |

### F — Antes de abrir a residentes reales
- Revisión de seguridad independiente de la API (agy, como con B0–B9).
- Texto de privacidad (Ley 18.331) y aviso de cómo se usan los datos.
- Prueba piloto con la administración de Confort antes de invitar residentes.

## Fuera del MVP (backlog)
2FA para empleados, pantalla de "Actividad" en el panel, OCR de comprobantes, recargos automáticos por mora, RLS de Postgres como segunda capa, app móvil.
