# Instrucciones para GitHub Copilot — Administración GC

Sistema de gestión de propiedad horizontal (consorcios) para Confort S.A., Montevideo, Uruguay.
Maneja dinero real de residentes: priorizá la corrección sobre la brevedad.

## Stack
- Python 3.12 + Django 5.x + Django REST Framework
- PostgreSQL 16, Celery + Redis, Cloudflare R2 (storage)
- Moneda: UYU. Idioma del dominio: español (nombres de modelos y campos en español).

## Reglas no negociables

### Dinero
- Montos: `DecimalField(max_digits=12, decimal_places=2)`. Nunca `FloatField` ni `float`.
- Redondeo con `decimal.ROUND_HALF_UP`.
- Prorrateo: `monto_unidad = total_gasto * (coeficiente / 100)`, calculado en el backend.
- Los coeficientes de un edificio suman exactamente `100.00`. Validarlo antes de distribuir.
- La suma de lo prorrateado debe ser igual al total (asignar la diferencia de redondeo de forma explícita).

### Ledger (`Movimiento`)
- Append-only: nunca `UPDATE` ni `DELETE` sobre movimientos. Las correcciones son un nuevo `Movimiento` de tipo `Ajuste`.
- Crédito (pago) positivo, débito (cargo) negativo.
- El saldo se calcula con `SUM(monto)`. Nunca guardar el saldo en una columna.
- En el Django admin, `Movimiento` es de solo lectura y no se puede borrar.

### Multi-tenant
- Todo modelo con datos de un edificio tiene FK a `Edificio`.
- Toda query de negocio filtra por `edificio`.
- El `edificio` sale del perfil del usuario autenticado, nunca del request body.

### Identificadores
- `id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` en todos los modelos.

### Transacciones y concurrencia
- Operaciones que tocan más de una tabla van en `transaction.atomic()`.
- La validación de pagos (update comprobante + insert movimiento + insert notificación) es atómica e idempotente: usar `select_for_update()` y verificar el estado antes de acreditar.

### Archivos
- Upload directo a R2 con presigned URLs; los archivos no pasan por Django.
- Descargas con presigned URLs de TTL ≤ 15 minutos.
- Solo `image/jpeg`, `image/png`, `application/pdf`, máximo 10 MB. Validar magic bytes en el backend.
- Nombre en storage = UUID, no el nombre original.

### Tareas asíncronas (Celery)
- PDFs de liquidación, emails masivos y exportación a Excel van en Celery.
- Las tareas deben ser idempotentes.

## Estilo
- Lógica de negocio en servicios o managers, no en las views.
- Comentarios solo para explicar el *por qué*.
- Nada de `except: pass`; loguear los errores.
- Cada cambio en lógica financiera viene con tests que usen valores concretos (coeficientes y montos conocidos).
