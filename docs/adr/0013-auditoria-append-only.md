# ADR-0013: Auditoría append-only de las acciones sensibles

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
Todos los usuarios de una administradora tienen los mismos permisos. Hay que poder saber quién emitió, aprobó, rechazó o registró qué.

## Decisión
`AuditLog` append-only (mismo trigger que el libro mayor), escrito por los servicios en la misma transacción que la acción. Guarda actor, organización, acción, objeto, IP y un JSON sin datos sensibles.

## Alternativas descartadas
- Logs de la aplicación: se rotan, no tienen estructura y no garantizan que la acción y su registro sean atómicos.

## Consecuencias
- Los tests de cada servicio verifican que la acción deja su registro.
