<!--
Manual del panel de administración (Planta Baja).
Lo muestra la Ayuda del panel (ícono "?"); ver la tarea B1.
Formato: cada artículo empieza con "## ", sigue una línea "grupo:" (sección de la Ayuda)
y una línea "tags:" con palabras que también lo encuentran en el buscador. Escrito en voseo, frases cortas, sin jerga contable.
-->

# Manual del panel

## Primeros pasos
grupo: Empezar
tags: inicio, empezar, vista general, cartera

La **Vista general** es la pantalla de inicio. Arriba ves cuatro cifras del mes:

- **Cobrado**: lo que ya entró, sobre el total emitido.
- **En revisión**: comprobantes que subieron los residentes y esperan tu validación.
- **Deuda vencida**: lo que quedó sin pagar de meses anteriores.
- **Reclamos abiertos**: consultas y problemas de los residentes sin resolver.

Debajo están los comprobantes para validar y la lista de edificios. Tocá un edificio para ver sus cobros, el resumen y los gastos.

El ícono de la bandeja, arriba a la derecha, junta todo lo pendiente.

## Agregar un edificio
grupo: Edificios y unidades
tags: nuevo edificio, alta, crear edificio

1. Tocá **Nuevo edificio** (en la Vista general o al final de la barra lateral).
2. Completá nombre, dirección y el día de vencimiento de cada mes (del 1 al 28).
3. Si querés, cargá la cuenta del banco para transferencias: sale impresa en la liquidación.
4. Al crearlo se abre directo el alta de la primera unidad.

## Agregar unidades
grupo: Edificios y unidades
tags: unidad, apartamento, apto, propietario, coeficiente, alta

1. Entrá al edificio y tocá **Agregar unidad**.
2. Escribí número, piso y **coeficiente** en porcentaje (por ejemplo 8,3333).
3. Cargá el **propietario**. El inquilino se agrega después, desde la ficha de la unidad.
4. Si la unidad ya debía algo al empezar a usar el sistema, ponelo en **Deuda inicial**.
5. Usá **Guardar y agregar otra** para seguir con la siguiente.

Arriba del formulario ves cuánto coeficiente va asignado. Los coeficientes del edificio tienen que sumar 100 % para poder emitir.

## Cargar los gastos del mes
grupo: Gastos y liquidaciones
tags: gastos, liquidación, ose, ute, limpieza, honorarios, cargar, borrador, cargar mes

Los gastos del mes se van cargando en un **borrador**, a medida que llegan las facturas:

1. Entrá al edificio, pestaña **Gastos**, y tocá **Cargar mes**.
2. Completá los montos que ya tengas y tocá **Guardar como borrador**.
3. Cuando llegue otro gasto, tocá **Seguir cargando** y sumalo.

Mientras está en borrador, los residentes no lo ven y lo podés corregir cuantas veces quieras.

El sistema reparte cada gasto según el coeficiente de cada unidad. Fondo de reserva y cuota extraordinaria van siempre al propietario. El resto lo paga el inquilino si hay, si no el propietario.

## Emitir la liquidación
grupo: Gastos y liquidaciones
tags: emitir, liquidación, pdf, enviar, borrador

Cuando el mes está completo, emitilo:

- En la pestaña **Gastos**, en la fila del mes en borrador: **Emitir**.
- O desde la ventana de gastos: **Guardar y emitir** (te pide confirmar).

Al emitir, la liquidación queda fija y cada residente la ve en su portal. Si después encontrás un error, se corrige con un **ajuste** en la cuenta de cada unidad.

En la pestaña **Gastos** descargás el **PDF** y el **Excel** de cada mes. Las unidades que reciben en papel aparecen arriba para imprimir.

## Validar un comprobante
grupo: Cobros
tags: comprobante, validar, aprobar, rechazar, transferencia, banco

Cuando un residente sube un comprobante, aparece en **Comprobantes para validar** y en la bandeja.

1. Tocá **Revisar**.
2. Compará con el extracto de tu banco: monto, cuenta de destino y fecha.
3. Si coincide, **Aprobar**: el pago entra a la cuenta del residente.
4. Si no, **Rechazar** con el motivo: el residente lo ve y puede subir otro.

## Registrar un pago sin comprobante
grupo: Cobros
tags: pago, efectivo, depósito, pago parcial, registrar pago

Para pagos en efectivo o depósitos que no se subieron:

1. Abrí la ficha de la unidad (tocá la fila en Cobros).
2. En **Registrar**, elegí **Registrar pago**.
3. Escribí el monto que entregó, la fecha y cómo lo verificaste.

Se paga contra el total de la cuenta, no gasto por gasto. Si debe $ 2.500 y entrega $ 2.000, queda debiendo $ 500, y el aviso te lo confirma.

## Hacer un ajuste
grupo: Cobros
tags: ajuste, corregir, bonificación, descuento, recargo, error, cobré de más

El ajuste corrige el saldo de una cuenta **sin que entre plata**. Nada se borra: se agrega un movimiento con el motivo.

- **Baja la deuda**: se cobró de más, una bonificación acordada, perdonar un recargo.
- **Sube la deuda**: un daño que pagó la administración, un pago que rebotó.

Abrí la ficha de la unidad → **Registrar** → **Ajuste**. El motivo es obligatorio porque lo ve el residente.

## Inquilinos, mudanzas y ventas
grupo: Edificios y unidades
tags: inquilino, mudanza, venta, propietario nuevo, ocupantes

Desde la ficha de la unidad → **Registrar** → **Ocupantes**:

- **Nuevo inquilino**: desde qué fecha empieza. Si había otro, el anterior termina el día antes.
- **Fin de alquiler**: el último día del inquilino. Desde ahí paga todo el propietario.
- **Venta**: el nuevo propietario y la fecha.

Los gastos del mes se reparten por días entre quienes ocuparon la unidad.

## Estados de una cuenta
grupo: Cobros
tags: al día, en revisión, pendiente, moroso, estado

- **Al día**: no debe nada.
- **En revisión**: subió un comprobante que todavía no validaste.
- **Pendiente**: debe el mes en curso, todavía dentro del plazo.
- **Moroso**: tiene meses vencidos sin pagar. Dice cuántos.
- **Sin liquidación**: el mes todavía no se emitió.

En la tabla de Cobros, **Pagado** es la parte del cargo del mes que ya está cubierta. Los pagos se aplican primero a la deuda más vieja.

## Avisos y reclamos
grupo: Comunicaciones y agenda
tags: aviso, reclamo, comunicaciones, responder, mensaje

En **Comunicaciones**:

- **Reclamos y reportes**: lo que escriben los residentes. Respondé y cambiá el estado (abierto, en curso, resuelto).
- **Avisos**: publicá un aviso para un edificio o para todos (cortes de agua, asambleas, obras).

## Historial y exportaciones
grupo: Historial
tags: historial, meses anteriores, excel, pdf, exportar, cuenta corriente

En **Historial** ves la cobranza de cada mes, las liquidaciones emitidas con su PDF y Excel, y la cuenta completa de cualquier unidad.

Todo se puede exportar a Excel o PDF, para quien prefiera papel.

## Agenda
grupo: Comunicaciones y agenda
tags: agenda, tareas, visitas, recordatorio

Anotá tareas y visitas de cada edificio (limpieza de tanques, revisión del ascensor). Se ordenan en vencidas, hoy, mañana y próximas.

## Tema noche y cuenta
grupo: Tu cuenta
tags: tema, noche, oscuro, claro, cerrar sesión, contraseña

- El ícono de luna o sol, arriba a la derecha, cambia entre tema claro y noche.
- Tocá tus iniciales para ver tu cuenta y **Cerrar sesión**.
- Si olvidaste la contraseña, usá **Olvidé mi contraseña** en la pantalla de ingreso.
