# ADR-0011: Dinero en Decimal, coeficientes como fracción y redondeo explícito

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
Los montos se reparten por coeficiente y por días, y la suma de lo repartido tiene que dar exactamente el total cargado.

## Decisión
Montos en `numeric(12,2)` y coeficientes en `numeric(7,6)` como fracción (0,086000 = 8,6 %), que por edificio suman exactamente 1. Redondeo `ROUND_HALF_UP` a centavos; la diferencia de redondeo de cada concepto se suma a la parte más grande del edificio. Todos los cálculos ocurren en el backend.

## Alternativas descartadas
- Coeficientes en porcentaje que suman 100: equivalente, pero mezcla escalas en las fórmulas.
- Calcular en el front: inseguro y no auditable.

## Consecuencias
- La API devuelve los montos como strings, para no pasar por `float` en JavaScript.
- Los tests usan los valores de referencia del front (`docs/golden/`).
