# Tarea: audit-front-final — Auditar el diseño final del front

## Contexto
El front quedó cerrado en `main` (commits `cc95571` y `b38b7f5`). Es el diseño final: el admin y el portal generan el mismo HTML que los prototipos de `design/ref/` y usan su CSS. La lógica (store en localStorage, ledger, validación de pagos) es la de siempre y se comparte entre admin y portal.

Pantallas a auditar (se abren directo en el navegador, sin servidor):
- `design/gc-login-admin.html` y `design/gc-login-residente.html`
- `design/admin.html`: cartera (`#/`) y cada edificio (`#/edificio/minas/cobros`, `/resumen`, `/gastos`, `/comunicaciones`; también `centro` y `pocitos`)
- `design/portal-residente.html` (por defecto Juan, apto 101; probá también `?b=minas&u=102:tenant` en revisión, `?b=minas&u=203:tenant` moroso y `?b=minas&u=104:owner` al día)

Referencia de cómo tiene que verse: `design/ref/capturas/*.png` (1440 y 390 px) y `design/DISENO.md` (reglas del cliente).

## Archivos tuyos
**Ninguno.** Esta tarea es de **solo lectura**: no modifiques ningún archivo del repo. El único archivo que escribís es tu reporte. Si querés hacer pruebas o capturas, trabajá en una copia fuera del repo (por ejemplo en `/tmp`).

## Qué revisar
1. **Cosas rotas:** errores en la consola, botones que no hacen nada, flujos que fallan. Probá como mínimo:
   - Admin: abrir y cerrar la ficha de unidad, "Ver comprobante" → Aprobar y Rechazar, "Cargar gastos" → Guardar borrador → Emitir (pestaña Gastos), publicar un aviso, responder un reclamo y cambiarle el estado, filtros de cobros, buscador, tema, barra plegable, atajos, gráfico, tareas (marcar y sumar), "Reiniciar datos de demo", Exportar a Excel.
   - Portal: tema, selector de mes (flechas y calendario), Copiar, "Ver mis movimientos", Mis comprobantes y su diálogo, avisos, nuevo reclamo, responder, "Simular respuesta", "Simular aprobación" → "Reiniciar la demo".
   - Que lo que se hace en el admin aparezca en el portal y al revés.
2. **Visual:** elementos desalineados, textos que se cortan o se superponen, contraste ilegible (sobre todo hovers y estados seleccionados), diferencias contra `ref/capturas`.
3. **Espaciado y estructura:** márgenes o separaciones inconsistentes entre secciones parecidas, jerarquía de títulos, alineación de columnas numéricas, tamaños de botones.
4. **Responsive:** a 390 px de ancho y a 1440 px. Ojo: Chrome headless no achica la ventana por debajo de 500 px; para 390 px usá un `<iframe>` de 390 px de ancho o el modo dispositivo.
5. **Accesibilidad básica:** foco visible con teclado, Escape cierra diálogos, labels en los campos.

## Formato de los hallazgos
En "Hecho" del reporte, una lista ordenada de **más grave a menos grave**. Cada hallazgo con:
- **Gravedad:** rota / visual / mejora
- **Dónde:** pantalla y `archivo:línea` si lo identificás
- **Qué pasa:** pasos para verlo
- **Sugerencia:** cómo lo arreglarías (sin aplicarlo)

No reportes como problema lo que `DISENO.md` marca como decisión del cliente (por ejemplo, filtros seleccionados en negro o el vidrio líquido en la barra del admin y en la tarjeta de pago).
