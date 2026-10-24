# Tarea: review-backend-b5-b7 — Segunda revisión independiente

## Contexto
Tu revisión de B0–B4 fue excelente: 8 hallazgos reproducidos, que el implementador está corrigiendo ahora (tarea SEC1, ver `docs/auditorias/2026-10-24-revision-backend-b0-b4.md`). Ahora revisá **lo que se construyó después**, con el mismo método:
- **B5** emitir la liquidación con prorrateo por coeficiente y días (`apps/settlements/services.py: issue_settlement`)
- **B6a** comprobantes y pagos (`apps/ledger/payments.py`)
- **B6b** estado de cuenta FIFO y venta (`apps/ledger/accounts.py`, `apps/people/services.py: sell_unit`)
- **B7** avisos, reclamos y tareas (`apps/communications/`)
- **B2b** gestión de ocupantes por empleados (`apps/people/services.py`)
- **B4b** el log de cambios (`apps/audit/`): no entraba en tu revisión anterior.

Leé `docs/modelo-datos.md` (sobre todo §1 y §5), `docs/adr/0006`, `0008`, `0009`, `0011`, `0015` y `0016`.

## Revisá una copia congelada, no el repo
El implementador está modificando `apps/settlements`, `apps/ledger`, `apps/accounts` y `apps/people` **ahora mismo** (SEC1). Para no ver cambios a medio hacer, trabajá sobre el commit `b573653` extraído fuera del repo:

```bash
rm -rf /tmp/agy-src && mkdir -p /tmp/agy-src && git archive b573653 | tar -x -C /tmp/agy-src
mkdir -p /tmp/agy-review2
docker compose run --rm -e DB_NAME=agy_review2 \
  -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review \
  web pytest -q -p no:cacheprovider /review
```
Así corrés tus pruebas contra ese código exacto, con tu propia base. **No modifiques nada del repo** (ni `backend/`, ni `docs/`, ni git). El único archivo que escribís es tu reporte.

No repitas los 8 hallazgos de la revisión anterior: ya están en corrección.

## Qué revisar
1. **Dinero.** ¿Hay forma de que lo distribuido en una emisión no dé exacto? ¿Casos límite del prorrateo: febrero bisiesto, ocupación de un solo día, inquilino y propietario que cambian el mismo día, una unidad con coeficiente muy chico cuya parte redondea a 0.00? ¿La imputación FIFO da lo mismo con pagos en distinto orden de carga? ¿Un saldo a favor se aplica bien?
2. **Autorización.** Para cada servicio de empleado y de residente: ¿un empleado de otra organización, un residente de otra unidad, un ex inquilino o un usuario sin persona pueden hacer algo que no deberían? Probá también con objetos de otra organización mezclados (por ejemplo, aprobar un comprobante cuya persona es de A pero cuyas ocupaciones son de B).
3. **Concurrencia e idempotencia.** Aprobar o emitir dos veces, cambiar de inquilino dos veces seguidas, vender dos veces: ¿se duplica algo?
4. **El log (B4b).** ¿Hay una forma de escribir en una tabla de negocio sin que quede registrada? ¿De falsear el `actor` (por ejemplo, un `set_config` que quede pegado entre transacciones o requests en una misma conexión)? ¿El log guarda datos sensibles que no debería?
5. **Calidad de los tests**: ¿hay tests que pasan sin probar lo que dicen?

## Formato
El mismo que la revisión anterior: hallazgos de **más grave a menos grave**, cada uno con gravedad, `archivo:línea` (del commit `b573653`), qué pasa con la prueba que hiciste (el comando y su salida) y la sugerencia. Solo lo que **reprodujiste**; lo demás va aparte como "sin confirmar".
