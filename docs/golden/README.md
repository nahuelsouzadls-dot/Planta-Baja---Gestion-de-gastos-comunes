# Valores de referencia del front (`docs/golden/`)

Datos y cálculos extraídos directamente del front (`design/assets/core.js`, `data.js` y `ledger.js`) evaluados sin modificaciones sobre Node (`vm.runInContext`), para contrastar los tests del backend.

## Cómo regenerar `demo.json`

```bash
node docs/golden/extraer.mjs
```

El script es determinístico: lee los archivos originales de `design/assets/`, ejecuta `GC.createSeed()` y escribe `docs/golden/demo.json` con todos los importes formateados como strings de 2 decimales (`"4153.80"`) y los coeficientes como strings de 8 decimales (`"0.08600000"`).

## Estructura de `demo.json`

- **`meta`**: fecha de corte (`today`: `"2026-10-21"`), mes en curso (`currentMonth`: `"2026-10"`), día de vencimiento (`dueDay`: `10`) y hash corto del commit (`commit`).
- **`portfolio`**: totales de la cartera calculados con la misma fórmula de `GC.views.home` en `design/assets/admin-views.js`:
  - `expected`: `"73830.00"` (en pantalla: `$ 73.830`)
  - `collected`: `"42024.90"` (en pantalla: `$ 42.025`)
  - `inReview`: `"11034.75"` (en pantalla: `$ 11.035`)
  - `debt`: `"18120.33"` (en pantalla: `$ 18.120`)
  - `accounts`: `49`, `moro`: `4`, `threads`: `2`
  *(Nota: `GC.fmt.money(v)` sin `withCents` aplica `Math.round(v)` al mostrar en pantalla).*
- **`buildings[]`**: un objeto por edificio (`minas`, `centro`, `pocitos`) con:
  - `id`, `name`, `reserveOpening`.
  - `units[]`: `{ n, floor, coef }`.
  - `expenses[]`: gastos por mes (`ose`, `ute`, `cleaning`, `fees`, `reserve`, `extraordinary`, `extraordinaryNote`, `total`) y `status` (`"emitido"` / `"abierto"`).
  - `chargesByMonth[month][unidad:rol]`: `{ charge, lines }` devueltos por `L.charge` y `L.chargeLines`.
  - `accounts[unidad:rol]`: estado de cuenta devuelto por `L.account` (`status`, `balance`, `unpaid`, `overdueMonths`, `currentCharge`, `review`) más `movements` devuelto por `L.movements`.
  - `summary`: resumen del edificio devuelto por `L.buildingSummary` (sin el array `accounts`).

---

## Diferencias conocidas entre el front y el modelo nuevo (`docs/modelo-datos.md`)

El backend **no** debe replicar estas simplificaciones del prototipo front:

1. **El front no prorratea por días ni modela mudanzas (N9, N10, D1, §5.3–5.4)**
   - En `ledger.js` (`L.chargeLines`), cada unidad tiene un único `owner` y un `tenant` fijo para todos los meses (`unit.tenant ? ['owner', 'tenant'] : ['owner']`), multiplicando directo `concepto × coef` sin `días / días_del_mes`.
   - **Ejemplo en `demo.json`**: en `minas`, la unidad `102` reparte todos los meses (`2026-07` a `2026-10`) al 100 % entre `102:tenant` (ordinarios) y `102:owner` (reserva/extraordinarios). En el backend nuevo, cada `Occupancy` tiene `start_date` y `end_date`, prorratea por días ocupados del mes y asigna al `owner` los días sin inquilino.

2. **El front cancela todos los meses adeudados al validar un pago, sin pagos parciales ni FIFO (N2, D2, D5)**
   - En `ledger.js` (`L.validatePayment`), aprobar un comprobante recorre `summary.unpaid` y marca **todos** los meses impagos de esa cuenta como pagados (`paid[m.month] = { date: state.today, ... }`), sin importe declarado ni pagos a cuenta.
   - **Ejemplo en `demo.json`**: en `minas`, `102:tenant` tiene `review: { "file": "comprobante_oct2026.jpg", "uploadedAt": "2026-10-10" }` sin monto asociado (`balance: "2606.20"`). Si una cuenta con varios meses impagos como `203:tenant` (`unpaid` en `2026-08`, `2026-09` y `2026-10` por `"7533.60"`) tuviera un comprobante en revisión y se validara, `L.validatePayment` marcaría pagados los 3 meses juntos. El backend nuevo registra asientos `LedgerEntry` (`kind = payment`) por el monto real verificado e imputa FIFO desde la deuda más antigua.

3. **La deuda en el front pertenece a `unidad:rol`; en el modelo nuevo pertenece a la `Occupancy` (N9, D1)**
   - En `data.js` y `ledger.js`, las cuentas se indexan por `"<unidad>:<rol>"` (`"203:tenant"`, `"101:owner"`).
   - **Ejemplo en `demo.json`**: en `minas`, `accounts["203:tenant"]` acumula `"7533.60"` de saldo (`"5013.60"` vencidos de agosto y setiembre más `"2520.00"` de octubre) asociados a la clave `"203:tenant"`. En el modelo nuevo la cuenta corriente es `Occupancy` (persona + unidad + rol + período): si Laura Sánchez se muda, sigue debiendo su período y el nuevo inquilino arranca en `"0.00"`.

4. **Redondeo con `round2` en punto flotante sin ajuste de centavos vs. `Decimal` con `ROUND_HALF_UP` y ajuste al mayor coeficiente (D9, §5.4)**
   - En `ledger.js`, `const round2 = (n) => Math.round(n * 100) / 100` redondea cada línea en `Number` IEEE 754 de manera independiente, sin ajustar la diferencia de redondeo contra el total del concepto.
   - **Caso real en `demo.json` donde la suma distribuida NO coincide con el total del concepto**:
     - Edificio **Pocitos** (`id: "pocitos"`), mes **`2026-08`**: tiene 16 unidades con coeficiente `"0.06250000"` (`1/16`).
     - El gasto de `ose` en `2026-08` es **`"5350.00"`**.
     - Cálculo por unidad: `5350 × 0.0625 = 334.375` → `round2(334.375) = "334.38"`.
     - Suma distribuida en las 16 unidades: `16 × 334.38 = "5350.08"` (**+$ 0,08 de diferencia** sobre `"5350.00"`).
     - En consecuencia, la suma de todos los cargos de `pocitos` en `2026-08` da **`"56850.08"`** en lugar del total de gastos **`"56850.00"`**, y la cuenta morosa `203:owner` de Pocitos registra en `2026-08` un cargo de `"3553.13"` (`334.38 + 581.25 + 875.00 + 1312.50 + 450.00`), trasladando ese centavo a `summary.debt = "10253.13"` y `portfolio.debt = "18120.33"`.
     - En el modelo nuevo (`docs/modelo-datos.md` D9), la diferencia de redondeo del concepto se ajusta en la unidad de mayor coeficiente para que la suma distribuida dé exactamente `"5350.00"`.

---

## Verificación manual paso a paso (Edificio Minas)

### 1. Cuenta `101:owner` — Juan Pérez (Apto 101, propietario sin inquilino)
- **Coeficiente**: `"0.08600000"` (`8,6 %`).
- **Regla de reparto**: como `tenant` es `null`, el propietario paga **todos** los conceptos (`ORDINARY` + `OWNER_ONLY`).

| Mes | O.S.E. (`×0.086`) | U.T.E. (`×0.086`) | Limpieza (`×0.086`) | Honorarios (`×0.086`) | Reserva (`×0.086`) | Extraord. (`×0.086`) | Cargo total | Estado del mes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `2026-07` | `3800 × 0.086 = 326.80` | `5900 × 0.086 = 507.40` | `8500 × 0.086 = 731.00` | `12000 × 0.086 = 1032.00` | `4800 × 0.086 = 412.80` | `0.00` | **`3010.00`** | Pagado (`2026-08-08`) |
| `2026-08` | `4100 × 0.086 = 352.60` | `7200 × 0.086 = 619.20` | `8500 × 0.086 = 731.00` | `12000 × 0.086 = 1032.00` | `4800 × 0.086 = 412.80` | `0.00` | **`3147.60`** | Pagado (`2026-09-05`) |
| `2026-09` | `3950 × 0.086 = 339.70` | `6420 × 0.086 = 552.12` | `8500 × 0.086 = 731.00` | `12000 × 0.086 = 1032.00` | `4800 × 0.086 = 412.80` | `0.00` | **`3067.62`** | Pagado (`2026-10-08`) |
| `2026-10` | `4200 × 0.086 = 361.20` | `6800 × 0.086 = 584.80` | `8500 × 0.086 = 731.00` | `12000 × 0.086 = 1032.00` | `4800 × 0.086 = 412.80` | `12000 × 0.086 = 1032.00` | **`4153.80`** | Impago (mes actual) |

- **Resultado en `accounts["101:owner"]`**:
  - `status`: `"pendiente"` (debe solo el mes en curso `2026-10`).
  - `currentCharge`: `"4153.80"`.
  - `unpaid`: `[{ "month": "2026-10", "amount": "4153.80" }]`.
  - `overdueMonths`: `[]`.
  - `balance`: `"4153.80"`.

### 2. Cuenta `203:tenant` — Laura Sánchez (Apto 203, inquilina)
- **Coeficiente**: `"0.08000000"` (`8,0 %`).
- **Regla de reparto**: la unidad está alquilada, por lo que `203:tenant` paga únicamente los conceptos **ordinarios** (`ose`, `ute`, `cleaning`, `fees`). El fondo de reserva y la cuota extraordinaria van a `203:owner` (Miguel Torres).

| Mes | O.S.E. (`×0.080`) | U.T.E. (`×0.080`) | Limpieza (`×0.080`) | Honorarios (`×0.080`) | Cargo `203:tenant` | Estado del mes |
|---|---:|---:|---:|---:|---:|---|
| `2026-07` | `3800 × 0.080 = 304.00` | `5900 × 0.080 = 472.00` | `8500 × 0.080 = 680.00` | `12000 × 0.080 = 960.00` | **`2416.00`** | Pagado (`2026-08-08`) |
| `2026-08` | `4100 × 0.080 = 328.00` | `7200 × 0.080 = 576.00` | `8500 × 0.080 = 680.00` | `12000 × 0.080 = 960.00` | **`2544.00`** | Impago (vencido) |
| `2026-09` | `3950 × 0.080 = 316.00` | `6420 × 0.080 = 513.60` | `8500 × 0.080 = 680.00` | `12000 × 0.080 = 960.00` | **`2469.60`** | Impago (vencido) |
| `2026-10` | `4200 × 0.080 = 336.00` | `6800 × 0.080 = 544.00` | `8500 × 0.080 = 680.00` | `12000 × 0.080 = 960.00` | **`2520.00`** | Impago (mes actual) |

- **Resultado en `accounts["203:tenant"]`**:
  - `status`: `"moroso"` (tiene meses anteriores a `2026-10` impagos y no está en revisión).
  - `currentCharge`: `"2520.00"`.
  - `overdueMonths`: `2026-08` (`"2544.00"`) y `2026-09` (`"2469.60"`) → deuda vencida = `2544.00 + 2469.60 = "5013.60"`.
  - `unpaid`: `2026-08` (`"2544.00"`), `2026-09` (`"2469.60"`), `2026-10` (`"2520.00"`).
  - `balance`: `2544.00 + 2469.60 + 2520.00 = "7533.60"`.

## Diferencias esperadas después de ADR-0017 (redondeo por mayor resto)
El backend reparte los centavos por el método del mayor resto ([ADR-0017](../adr/0017-redondeo-por-mayor-resto.md)) y el front redondea cada parte por separado. La única consecuencia en la demo es **Edificio Pocitos, agosto 2026, O.S.E. $ 5.350,00**:

| | Front | Backend |
|---|---|---|
| Unidades 101 a 204 | $ 334,38 | $ 334,38 |
| Unidades 301 a 404 | $ 334,38 | $ 334,37 |
| Total repartido | $ 5.350,08 | $ 5.350,00 |

Por eso el cargo de agosto de 301, 302 (inquilino), 303, 304, 401, 402 (inquilino), 403 y 404 es un centavo menor que en `demo.json`; la deuda del inquilino de la 402 es $ 3.124,99 en vez de $ 3.125,00, y la deuda vencida de la cartera es **$ 18.120,32** en vez de $ 18.120,33. Verificado cuenta por cuenta el 2026-10-24: no hay ninguna otra diferencia.
