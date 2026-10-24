# Tarea: golden-front — Valores de referencia del front para los tests del backend

## Estado (retomar)
Una corrida anterior se cortó. `docs/golden/extraer.mjs` ya existe y funciona: genera `demo.json` y los totales de la cartera coinciden con la pantalla. **No lo reescribas desde cero**: revisalo, corregilo si hace falta, y completá lo que falta: el paso 3 (verificación), el 4 (README con diferencias conocidas) y el 5 (dos cuentas a mano), más la verificación de que es determinístico.

## Contexto
El backend se está reescribiendo según `docs/modelo-datos.md`. Para saber si calcula bien, sus tests van a comparar contra **valores de referencia ("golden")** sacados del front final, cuya lógica ya está validada visualmente: `design/assets/ledger.js` (cálculos) y `design/assets/data.js` (datos de la demo: edificios Minas, Centro y Pocitos).

Tu trabajo es extraer esos valores ejecutando el JS real del front con Node, sin reimplementar nada a mano.

## Archivos tuyos
- `docs/golden/` (todo; creala)

**No toques nada más.** En particular, no modifiques `design/` ni `backend/`: otro agente está trabajando en `backend/` en paralelo.

## Pasos
1. Leé `design/assets/core.js`, `data.js` y `ledger.js`. Son IIFE que cuelgan todo de `window.GC`.
2. Escribí `docs/golden/extraer.mjs`, un script de Node (v18 o más) que:
   - Cree un `window` y un `localStorage` mínimos (objetos simples) antes de evaluar los archivos, y cargue `core.js`, `data.js` y `ledger.js` **leyéndolos del disco** con `vm.runInContext` (no los copies ni los modifiques).
   - Tome el estado inicial con `GC.createSeed()`.
   - Escriba `docs/golden/demo.json` con:
     - `meta`: `today`, `currentMonth`, `dueDay` y el commit de git del que salió (`git rev-parse --short HEAD`).
     - Por edificio: `id`, `name`, la lista de unidades (`n`, `floor`, `coef` como **string** con todos sus decimales), los gastos de cada mes (cada concepto como string) y su estado (`emitido`/`abierto`).
     - Por edificio y mes emitido: el cargo de cada cuenta (`unidad:rol`), usando `L.chargeLines` y `L.charge`, con el detalle por concepto.
     - Por cuenta: el resultado de `L.account(...)` (status, balance, unpaid, overdueMonths, currentCharge) y `L.movements(...)` completo.
     - Por edificio: el resultado de `L.buildingSummary(...)` sin el array `accounts` (counts, expected, collected, inReview, debt, reserveFund, openThreads, expenseTotal).
     - `portfolio`: los totales de la cartera como los calcula `admin-views.js` en `GC.views.home` (expected, collected, inReview, debt, threads, accounts, moro), recalculados en el script con la misma fórmula.
   - **Todos los montos como strings con 2 decimales** (por ejemplo `"4153.80"`), para que el backend los lea como `Decimal` sin pasar por `float`.
3. Corré el script y verificá que los totales de la cartera coincidan con lo que muestra la pantalla: cobrado **$ 42.025** de **$ 73.830**, en revisión **$ 11.035**, deuda vencida **$ 18.120**, **49** cuentas, **4** morosas, **2** reclamos abiertos. Si algo no coincide, investigá por qué y anotalo; no ajustes los números a mano.
4. Escribí `docs/golden/README.md` (corto) con:
   - Qué es cada sección de `demo.json` y cómo regenerarlo (`node docs/golden/extraer.mjs`).
   - **Diferencias conocidas entre el front y el modelo nuevo** que el backend NO debe copiar. Mirá el código y listá al menos estas, confirmando cada una con un ejemplo concreto del JSON:
     - El front no prorratea por días: no tiene mudanzas.
     - El front marca pagados todos los meses adeudados al validar, sin pagos parciales; el modelo nuevo imputa FIFO.
     - La deuda en el front es de `unidad:rol`; en el modelo nuevo es de la ocupación (persona + período).
     - Cómo redondea el front (`round2` u otra función) y si la suma de lo distribuido da exactamente el total de cada concepto. Si no da, mostrá la diferencia con un caso real.
5. Revisá el JSON a mano en dos cuentas (la 101 propietario de Minas y la 203 inquilino de Minas) haciendo la cuenta con lápiz: total del concepto × coeficiente. Dejá esas dos cuentas explicadas paso a paso en el README.

## Cómo verificar
- `node docs/golden/extraer.mjs` corre sin errores y regenera el mismo `demo.json` (determinístico: correrlo dos veces da un diff vacío).
- `git status` muestra cambios **solo** dentro de `docs/golden/`.

## Formato del reporte
El del protocolo. En "Hecho" incluí los totales de la cartera que te dio el script y la lista de diferencias conocidas.
