# ADR-0007: Libro mayor append-only, garantizado por la base

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
El libro mayor es la fuente de verdad financiera y tiene que ser auditable. El esqueleto anterior solo bloqueaba la edición en `save()`, que se saltea con `QuerySet.update()`, el admin o SQL directo.

## Decisión
`LedgerEntry` no se modifica ni se borra: un trigger de Postgres rechaza `UPDATE`, `DELETE` y `TRUNCATE`. Una corrección es un asiento `adjustment` que apunta al que corrige. Signo: **positivo = debe, negativo = haber**. El saldo es `SUM(amount)` y nunca se guarda. Cada cargo guarda la foto de su cálculo (base, coeficiente, días).

## Alternativas descartadas
- Solo validación en Django: no protege contra errores fuera del ORM.
- Event sourcing completo: más poder del que el MVP necesita.

## Consecuencias
- Las FK hacia el libro mayor son `PROTECT`: lo que tiene historia se desactiva, no se borra.
- Los tests tienen que probar que `UPDATE` y `DELETE` fallan también con SQL crudo.
- Cambiar un coeficiente no reescribe cargos pasados.
