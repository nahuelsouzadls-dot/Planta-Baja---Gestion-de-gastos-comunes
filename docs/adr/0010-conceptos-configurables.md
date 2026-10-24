# ADR-0010: Conceptos de gasto configurables por edificio

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
Cada edificio tiene gastos distintos (ascensor, jardinería, seguro). El esqueleto anterior tenía una columna por concepto, y cada concepto nuevo era una migración.

## Decisión
`ExpenseConcept` por edificio, de tipo `ordinary` (inquilino, o propietario si no hay inquilino) u `owner_only` (fondo de reserva, extraordinarias). Un edificio nuevo arranca con los seis conceptos de siempre. `SettlementItem` guarda el monto de cada concepto en cada liquidación.

## Alternativas descartadas
- Columnas fijas: simple, pero rígido.

## Consecuencias
- El front pasa a recibir la lista de conceptos desde la API en vez de tenerla fija.
