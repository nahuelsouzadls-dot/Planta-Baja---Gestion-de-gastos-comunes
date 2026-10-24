# ADR-0008: El pago es la verificación de la administración; el comprobante es evidencia

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
No hay integración con el banco. Lo que da por pagado un mes es que una persona de la administración confirme la transferencia en el extracto de Scotiabank. El comprobante del residente sirve como respaldo si después hay un error o un reclamo.

## Decisión
Un pago es un `LedgerEntry` de tipo `payment` con `created_by` obligatorio. El `Receipt` (archivo, sha256, quién lo subió) es evidencia aparte: al aprobarlo se crean los pagos apuntando a él; si se rechaza, el libro mayor no se toca y el archivo se conserva. La administración puede registrar un pago sin comprobante, indicando dónde lo verificó. Un comprobante puede repartirse entre varias unidades de la misma persona, con la aclaración del residente.

## Alternativas descartadas
- Estado de pago dentro del movimiento (esqueleto anterior): obliga a modificar un registro que debería ser inmutable.
- Validación automática por OCR o API del banco: fuera del MVP; queda en el backlog.

## Consecuencias
- Aprobar es idempotente: `SELECT … FOR UPDATE` más chequeo de estado `pending`.
- Cada pago tiene un responsable identificable en el libro mayor y en la auditoría.
