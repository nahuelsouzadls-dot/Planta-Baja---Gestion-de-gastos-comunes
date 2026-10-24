# ADR-0006: La cuenta corriente es la ocupación (persona + unidad + rol + período)

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
En Uruguay, el contrato de alquiler hace que el inquilino deba los gastos comunes del período en que ocupó la unidad. Si se muda en marzo, sigue debiendo febrero; quien entra arranca en 0. Sin inquilino, el propietario asume todo. El vendedor tiene que estar al día para vender.

## Decisión
La cuenta corriente es una `Occupancy`: persona, unidad, rol y fechas desde/hasta. Los cargos de un mes se reparten entre las ocupaciones que se superponen con ese mes, **prorrateados por días**. Una restricción `EXCLUDE` impide dos ocupaciones del mismo rol superpuestas en la misma unidad. Cerrar la ocupación de un propietario exige saldo 0.

## Alternativas descartadas
- Cuenta por unidad (como el front de la demo): la deuda de un inquilino que se fue quedaría a cargo del siguiente.
- Cuenta por persona: no distingue entre dos unidades de la misma persona ni entre roles.

## Consecuencias
- El historial de quién ocupó qué queda completo y con fechas.
- Un inquilino que se fue con deuda sigue apareciendo como moroso.
- Una persona puede tener varias ocupaciones, en edificios distintos, con un solo usuario.
