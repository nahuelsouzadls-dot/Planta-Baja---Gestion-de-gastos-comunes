# Instrucciones para GitHub Copilot — Administración GC

Sistema de gestión de propiedad horizontal (consorcios) para Confort S.A., Montevideo, Uruguay.
Maneja dinero real de residentes: priorizá la corrección sobre la brevedad.

## Stack
- Python 3.12 + Django 5.x + Django REST Framework
- PostgreSQL 16, Celery + Redis, Cloudflare R2 (storage)
- Moneda: UYU. Idioma del dominio: español (nombres de modelos y campos en español).
- Front (ADR-0018): React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui en `frontend/`, con TanStack Query y React Router. Django sirve el build (`frontend/dist`) desde el mismo origen.

## Front (`frontend/`)
- **Dirección visual del cliente (`design/DISENO.md`), no negociable:** plano y sobrio, fondo gris y tarjetas blancas de radio 12, color solo en la barra lateral y en acentos chicos. Nada de amarillo como acento, botones azules o cian rellenos, botones muy redondos o gruesos, degradados de fondo ni aspecto "startup". Seleccionado en filtros: negro con letra blanca.
- **Usá los tokens de `src/index.css`** (`bg-card`, `text-muted-foreground`, `bg-side`, `text-ok`, `bg-bad-bg`, etc.); no escribas colores sueltos. Los 5 temas cambian `--side`/`--acc`/`--accl` con `data-theme` en `<html>`.
- **Componentes:** primero los de `src/components/ui/` (shadcn) y `src/components/shared.tsx` (`Pill`, `StatusPill`, `Empty`, `ErrorState`). Si falta uno, agregalo ahí con el mismo estilo; no instales otra librería de componentes.
- **Datos:** toda llamada a la API pasa por `src/lib/api.ts` (cookie de sesión + CSRF). Lecturas con `useQuery` y escrituras con `useMutation` que invalidan la caché (ver `features/*/data.ts`). Tipos de las respuestas en `src/lib/types.ts`.
- **Montos:** llegan como texto y se muestran con `money()` de `src/lib/format.ts`. **Nunca se calcula dinero en el front**: totales, saldos y prorrateos vienen del backend (ADR-0011). Lo que escribe una persona se convierte con `amountText()`, sin pasar por `Number`.
- **Estados de pantalla:** cada lista o vista con datos tiene carga (esqueleto), vacío (`Empty` con texto que explique qué hacer) y error (`ErrorState` con Reintentar). Errores de formulario con `FormError`, en el formulario; confirmaciones con `toast` de sonner, en tono calmo y específico.
- **Accesibilidad:** etiquetas en todos los campos, `aria-label` en botones de solo ícono, foco visible y nada que dependa solo del color (los estados llevan texto).
- `npm run build` (en `frontend/`) verifica tipos y compila; tiene que pasar sin errores.

## Reglas no negociables

El modelo de datos aprobado está en `docs/modelo-datos.md`. Si una tarea contradice ese documento, gana el documento: anotalo como pregunta en tu reporte.

### Dinero
- Montos: `DecimalField(max_digits=12, decimal_places=2)`. Nunca `FloatField` ni `float`.
- Redondeo con `decimal.ROUND_HALF_UP`.
- Coeficientes: `DecimalField(max_digits=7, decimal_places=6)` como **fracción** (`0.086000` = 8,6 %). Los de un edificio suman exactamente `1`; validarlo antes de distribuir.
- Prorrateo: `monto = total_concepto * coeficiente * dias_ocupados / dias_del_mes`, calculado en el backend.
- La suma de lo prorrateado debe ser igual al total (asignar la diferencia de redondeo de forma explícita).

### Ledger (`LedgerEntry`)
- Append-only: nunca `UPDATE` ni `DELETE` sobre asientos, y lo garantiza un trigger de Postgres. Las correcciones son un asiento nuevo de tipo `adjustment` que apunta al que corrige.
- Signo: **positivo = debe (cargo), negativo = haber (pago)**. El saldo de una ocupación es `SUM(amount)`; positivo significa que debe.
- Nunca guardar el saldo en una columna.
- En el Django admin, `LedgerEntry` es de solo lectura y no se puede borrar.
- Un pago es un asiento `payment` registrado por un usuario de la administración (`created_by` obligatorio). El comprobante (`Receipt`) es solo evidencia.

### Multi-tenant
- La raíz de aislamiento es `Organization` (la administradora). Todo dato de negocio cuelga de una organización, directa o indirectamente (`Building` → `organization`).
- Toda query del panel filtra por las organizaciones del usuario (`OrgMembership`); toda query del portal, por las ocupaciones de la `Person` del usuario.
- La organización sale del usuario autenticado, nunca del request body ni de la URL sin verificar.
- Cada endpoint tiene un test que demuestra que un usuario de otra organización recibe 404.

### Identificadores
- `id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` en todos los modelos.

### Registro de cambios (quién editó qué)
- Toda tabla nueva de negocio engancha el trigger de auditoría en su propia migración con `apps.audit.operations.AuditTrigger(tabla, exclude=[columnas sensibles])`. El test de cobertura de `apps/audit` falla si falta.
- Toda escritura de negocio corre dentro de `audit_context(actor, organization=...)` o de un request con `AuditContextMiddleware`, para que la base sepa qué empleado hizo el cambio.
- Nunca guardes secretos (`password`, `token_hash`) en los valores auditados: van en `exclude`.

### Transacciones y concurrencia
- Operaciones que tocan más de una tabla van en `transaction.atomic()`.
- La validación de pagos (update comprobante + insert movimiento + insert notificación) es atómica e idempotente: usar `select_for_update()` y verificar el estado antes de acreditar.

### Archivos
- Upload directo a R2 con presigned URLs; los archivos no pasan por Django.
- Descargas con presigned URLs de TTL ≤ 15 minutos.
- Solo `image/jpeg`, `image/png`, `image/heic`, `image/webp` y `application/pdf`, máximo 10 MB. Validar magic bytes en el backend.
- Nombre en storage = UUID, no el nombre original.

### Seguridad
- Usuario propio `accounts.User` con **email** como login (`AUTH_USER_MODEL = 'accounts.User'`); nunca usar `django.contrib.auth.models.User` directo, siempre `get_user_model()`.
- Contraseñas con Argon2; bloqueo por intentos fallidos con `django-axes`.
- Sesión de Django con cookies `HttpOnly`, `Secure` y `SameSite=Lax` más CSRF. No usar JWT ni guardar tokens en `localStorage`.
- DRF con `IsAuthenticated` por defecto; ningún `AllowAny` salvo login e invitaciones.
- Secretos solo desde variables de entorno (`.env` local, ignorado por git). `.env.example` lleva valores de ejemplo, nunca secretos reales.
- No loguear emails, CI ni montos en texto plano.

### Tareas asíncronas (Celery)
- PDFs de liquidación, emails masivos y exportación a Excel van en Celery.
- Las tareas deben ser idempotentes.

## Estilo
- Lógica de negocio en servicios o managers, no en las views.
- Comentarios solo para explicar el *por qué*.
- Nada de `except: pass`; loguear los errores.
- Cada cambio en lógica financiera viene con tests que usen valores concretos (coeficientes y montos conocidos).
