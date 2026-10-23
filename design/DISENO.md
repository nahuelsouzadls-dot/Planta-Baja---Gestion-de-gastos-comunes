# Administración GC — handoff de diseño

Producto B2B SaaS de gastos comunes (propiedad horizontal, Uruguay). Dos superficies: **panel de administración** (Confort S.A. administra edificios) y **portal del residente**. Logo y nombre ("Gastos comunes") son provisorios.

## Archivos
- `prototipos/gc-admin.html`, `gc-portal.html`, `gc-login-admin.html`, `gc-login-residente.html`: prototipos autocontenidos, interactivos, abribles en el navegador (los 4 se enlazan entre sí en la misma carpeta). Usan un shim propio de x-dc; la lógica vive en el `<script type="text/x-dc">` de cada uno (clase `Component`, `state`, `renderVals`).
- `fuentes-canvas/*.dc.html`: mismo código en formato del canvas de diseño (necesita su runtime `support.js`; solo referencia).
- Los logins tienen la foto de fondo incrustada en base64 (CSS `.gl`).

## Dirección visual
Plano, sobrio, profesional. Fondo gris `#f4f5f7`, tarjetas blancas con borde 1px `#e3e6eb`, radio 12. Color solo en la barra lateral (tema) y acentos chicos. Sin degradados, sin brillo/pulso continuo, sin serif. **Excepciones aprobadas:** barra lateral del admin con "vidrio líquido" (manchas desenfocadas lentas + reflejo) y las pantallas de login con foto desenfocada.
Lo que NO le gusta al cliente: cian/azul como relleno de botones, acentos amarillos, exceso de cajas, tarjetas enormes, botones muy redondos/gruesos, bordes "encendidos" permanentes, selección en negro sólido, serif, aspecto "startup".

## Tokens
- Texto `#12151a` / `#454c57` / `#5d6573`; línea `#e8ebef`; hover `#f0f2f5`; botón primario `#12151a` (hover `#2b3038`).
- Tipografía: títulos Plus Jakarta Sans (portal), Manrope (admin); texto DM Sans (portal) / Inter (admin); números JetBrains Mono / Manrope (los números gustan, no tocar).
- Temas (estilo Slack, color de barra + acento): Lagoon (default, side `#0e4a5e`, acc `#12909f`, accl `#7fe0ee`), Azul noche `#14233d/#2a86bd`, Berenjena `#3b1f45/#1f9e80`, Grafito `#25282e/#d9604f`, Bosque `#1d3b2f/#a97a2b`. Persisten en `localStorage['gc-theme']`. Selector: icono de paleta + desplegable con mini previews.
- Estados: pagado verde, revisión ámbar, pendiente ámbar claro, moroso rojo. Edificio con cuenta ≥2 meses vencida: fila con fondo rojo suave + barra lateral roja.

## Reglas de interacción
- Seleccionado = tinte suave del acento + borde fino (admin) / borde negro 1.5px sobre blanco (portal). **El negro de fondo aparece solo en hover** de chips/botones secundarios del admin.
- Admin: barra lateral flotante colapsable (empieza solo íconos, tooltips), búsqueda 340px, FABs abajo a la derecha (Atajos, Cobrado por mes, Tareas), tareas por edificio, "Ver comprobante" abre diálogo con checklist y Aprobar/Rechazar.
- Portal: escritorio = saludo arriba solo, bloque de pago (monto izquierda, datos de transferencia con "Copiar" a la derecha), botón "Subir comprobante" (color oscuro del tema) pegado debajo con texto chico gris, y debajo pestañas a ancho completo. Celular = una columna (el cliente aprueba el celular tal cual).
- Pestañas del portal: Mi liquidación (selector de mes con flechas + calendario por año, hasta 5 años atrás, sin meses futuros, puntos de estado), Mis comprobantes (aprobado/en revisión/rechazado con motivo y reintento, abre comprobante), Avisos, Problemas y reclamos (hilo tipo chat/ticket con estado Recibido/En proceso/Resuelto).
- Demo: "Simular aprobación" → "Hola, Juan, estás al día"; "Reiniciar la demo".
- Login (admin y residente, ambos con contraseña): cajita estilo panel de reservas de un hotel: casi sin relleno, `backdrop-filter: blur(28px)`, borde 1px claro, radio 24, campos como filas con divisores y etiqueta mayúscula chica en `--accl`, botón "Ingresar" transparente con hover celeste parcial (`accl` al 34%). Fondo: foto de edificio con cielo azul, desenfocada entera (`filter: blur(14px)` + overlay oscuro .3).

## Lógica de negocio
Prorrateo por coeficiente de la unidad. Inquilino paga gastos ordinarios (OSE, UTE, limpieza, honorarios); propietario paga fondo de reserva + extraordinarias. Vencimiento día 10. Estados de cuenta: pagado / revisión / pendiente / moroso / sin cargar. Datos de ejemplo: CUR=2026-10, TODAY=2026-10-21.

## Pendiente
Íconos (revisar estilo único), inbox de reclamos del admin con notas internas, adjuntar fotos en reclamos (sin decidir), identidad visual/logo definitivo, color del pie "¿Dudas?".
