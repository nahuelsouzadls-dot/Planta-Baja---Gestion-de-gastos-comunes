# ADR-0017: Redondeo del prorrateo por el método del mayor resto

- **Estado:** Aceptada
- **Fecha:** 2026-10-24
- **Reemplaza:** la regla de redondeo de [ADR-0011](0011-dinero-decimal-y-redondeo.md) ("la diferencia va a la parte más grande"). El resto de ADR-0011 sigue vigente.

## Contexto
Al repartir un concepto entre unidades por coeficiente y por días, las partes tienen más de dos decimales y hay que redondearlas a centavos, pero la suma tiene que dar **exactamente** el monto del concepto.

ADR-0011 sumaba toda la diferencia de redondeo a la parte más grande. La segunda revisión independiente (`docs/auditorias/2026-10-24-revision-backend-b5-b7.md`, hallazgo 5) mostró que, cuando la diferencia es negativa y llega a la parte más grande (muchas partes chicas, por ejemplo con mudanzas), esa parte queda en cero o negativa y la emisión falla. Además, cargar toda la diferencia a una sola unidad no es parejo: en Pocitos (agosto, O.S.E. $ 5.350), una unidad pagaba $ 334,30 y las otras quince $ 334,38.

`docs/modelo-datos.md` D9 decía "la unidad de mayor coeficiente" y §5 "la parte más grande": dos reglas distintas para lo mismo. agy lo señaló.

## Decisión
**Método del mayor resto (Hamilton)**, por cada concepto de la liquidación, sobre todas sus partes en el edificio:
1. Se calcula cada parte exacta, `monto × coeficiente × días / días_del_mes`, sin redondear.
2. Cada parte se trunca a centavos (hacia abajo).
3. Los centavos que faltan para llegar al monto del concepto se reparten **de a uno** entre las partes con **mayor fracción descartada**.
4. Desempate, para que el resultado sea siempre el mismo: menor número de unidad primero y, dentro de la unidad, propietario antes que inquilino y la ocupación que empezó antes.

Propiedades: la suma da exacta siempre, ninguna parte se mueve más de un centavo respecto de su valor exacto, ninguna queda negativa y ninguna unidad absorbe la diferencia de todas.

Ejemplo, Pocitos agosto, O.S.E. $ 5.350,00 entre 16 unidades de coeficiente 0,0625: la parte exacta es 334,375. Truncadas dan 16 × 334,37 = 5.349,92; faltan 8 centavos, que van a las 8 unidades de menor número. Resultado: 8 pagan $ 334,38 y 8 pagan $ 334,37.

## Alternativas descartadas
- **Diferencia a la parte más grande** (ADR-0011): falla en el caso límite y no es pareja.
- **Diferencia a la unidad de mayor coeficiente** (lo que decía D9): mismo problema, y con mudanzas esa unidad puede tener partes chicas.
- **Redondear cada parte y no corregir:** es lo que hace el front y por eso cobra $ 5.350,08.

## Consecuencias
- Cambia la expectativa del test de Pocitos (ya no hay una unidad en $ 334,30).
- `IssueSummary` informa, por concepto, cuántos centavos se repartieron.
- Cada cargo sigue guardando la foto de su cálculo; el centavo extra se ve como diferencia entre `base × días / días_del_mes` y `amount`.
