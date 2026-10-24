# ADR-0015: Registro de cambios en la base: quién editó qué, con antes y después

- **Estado:** Aceptada
- **Fecha:** 2026-10-24
- **Complementa a:** [ADR-0013](0013-auditoria-append-only.md)

## Contexto
Todos los empleados de una administradora tienen los mismos permisos (N8). Nahuel pidió que quede **registrado en la base qué empleado edita qué**, como control para evitar desvíos.

ADR-0013 solo preveía eventos de negocio escritos por los servicios ("aprobó un pago"). Eso deja dos huecos:
1. Un cambio hecho **por fuera de los servicios** (el admin de Django, un script o SQL directo) no deja rastro.
2. No queda el **valor anterior**: si alguien cambia un coeficiente, un dato bancario o el monto de un borrador, no se puede saber qué había antes.

## Decisión
Dos capas complementarias:

**1. Registro de cambios por fila (`audit_rowchange`), con triggers de Postgres.**
- Una función genérica `audit_row_change()` se engancha con `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` en **todas las tablas de negocio**: organizaciones y membresías, usuarios (sin la columna `password`), edificios, unidades, conceptos, personas, ocupaciones, liquidaciones y sus ítems, libro mayor, comprobantes, avisos, reclamos y tareas.
- Por cada cambio guarda: tabla, id de la fila, operación (`INSERT`, `UPDATE` o `DELETE`), **valores anteriores** y **valores nuevos** (JSON; en un `UPDATE`, solo las columnas que cambiaron), actor, organización, origen de la petición (IP, ruta) y fecha y hora.
- **El actor lo pasa la aplicación a la base** en cada transacción: `set_config('app.actor_id', '<uuid>', true)` (el `true` hace que valga solo para esa transacción). Lo setean un middleware para cada request y un helper `audit_context(user)` para servicios, comandos y tareas de Celery.
- Si un cambio llega **sin actor** (SQL directo, un script sin contexto), igual se registra, con `actor = NULL` y el usuario de Postgres (`current_user`). Un cambio sin actor de la app es una alerta en sí mismo.
- Las columnas sensibles se excluyen o se enmascaran en el JSON: `password` y `token_hash` nunca se copian.

**2. Eventos de negocio (`AuditLog`, ADR-0013).**
Siguen existiendo para lo que un diff de filas no explica: "aprobó el comprobante X por $ 2.615 de María García, apto 102" es una sola acción que toca cinco filas.

**Ambas tablas son append-only**, con el mismo trigger que el libro mayor: nadie puede editar ni borrar su propio rastro, ni siquiera desde el admin.

## Alternativas descartadas
- **Señales de Django (`post_save`) o `django-simple-history`:** no ven `QuerySet.update()`, `bulk_create` ni SQL directo, que es justamente por donde se haría un desvío.
- **`django-pghistory`:** usa la misma técnica de triggers y es una buena librería, pero agrega dos dependencias para algo que acá son unas 60 líneas de SQL que controlamos por completo.
- **Solo logs de la aplicación:** se rotan, no tienen estructura y se pueden borrar.

## Consecuencias
- Toda escritura de negocio corre dentro de una transacción con actor: el middleware envuelve cada request que escribe, y los tests verifican que el actor llegue a la base.
- El registro crece con cada cambio. Para un edificio de 12 unidades es despreciable; para muchas organizaciones se particiona por mes más adelante. **No se borra.**
- Es la base para una pantalla futura de "Actividad" en el panel (quién hizo qué, filtrable por empleado, edificio y fecha) y para alertas: por ejemplo, un resumen diario de ajustes, pagos registrados sin comprobante y cambios de datos bancarios.
- Datos personales: el registro contiene emails y teléfonos en los valores anteriores. Se trata igual que la tabla original (Ley 18.331); ante un pedido de baja, se anonimiza.
