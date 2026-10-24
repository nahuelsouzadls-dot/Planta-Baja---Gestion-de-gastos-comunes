# ADR-0009: La imputación de pagos (FIFO) se calcula al leer

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
Se aceptan pagos parciales: cubren primero la deuda más vieja y lo que sobra queda como saldo a favor. Hace falta saber qué meses están cubiertos para mostrar estados como "moroso".

## Decisión
La imputación no se guarda: se calcula a partir de los asientos de la ocupación, ordenando los cargos por mes. Es determinística y siempre coincide con el libro mayor.

## Alternativas descartadas
- Tabla de imputaciones: sería una tabla mutable más, que puede quedar desincronizada con los asientos.

## Consecuencias
- Si la cartera crece y hace falta velocidad, se agrega una vista materializada, nunca una columna editable.
