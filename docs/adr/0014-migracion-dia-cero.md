# ADR-0014: Migración día cero con asiento de apertura

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
El cliente opera hoy con Excel y papel. Migrar todo el histórico es caro y propenso a errores.

## Decisión
No se migra el histórico. Por cada ocupación vigente se crea un asiento `opening` con el saldo consolidado a una fecha de corte (`Building.opening_date`), y el fondo de reserva arranca en `Building.reserve_opening`.

## Alternativas descartadas
- Migrar el histórico completo desde Excel.

## Consecuencias
- El cliente conserva sus planillas como referencia del período anterior.
- La contingencia en papel (exportar a Excel y PDF) sigue disponible.
