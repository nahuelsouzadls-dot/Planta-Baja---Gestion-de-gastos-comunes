# Reporte: antigravity — audit-design

## Hecho
- Leí los archivos listados en la tarea que existen: `design/admin.html`, `design/portal-residente.html`, `design/assets/tokens.css`, `design/assets/admin.css`, `design/assets/admin-sections.css`, `design/assets/ui.css` y `design/assets/portal.css`.
- Las rutas `design/admin-views.js` y `design/portal.js` indicadas en la tarea no existen. No inspeccioné otras rutas no listadas; por eso la evaluación de estados y acciones dinámicas queda limitada a los shells HTML y CSS.

## Hallazgos

### ✅ Lo que funciona bien
- La base visual es consistente con un CRM sobrio: superficies blancas, líneas finas, navy reservado para marca/selección y radios pequeños (`design/assets/tokens.css`, `design/assets/admin.css`).
- La jerarquía de color de estados está bien planteada: `--paid`, `--review`, `--overdue` y sus fondos suaves se reutilizan en `.status`, `.figure--*` y las barras segmentadas (`design/assets/tokens.css`, `design/assets/ui.css`).
- Las tablas tienen una estructura funcional y densa: encabezado sticky, números monoespaciados y filas de 8px verticales, adecuados para revisar cartera/ledger (`design/assets/ui.css`, `.ledger td`).
- El portal tiene decisiones acertadas para personas mayores: una columna, acción de carga a ancho completo, campos de 44px y layout de pasos que colapsa en móvil (`design/assets/portal.css`, `.upload .btn`, `.claim-form .input`).
- Hay estados de foco visibles y soporte de `prefers-reduced-motion`, dos bases importantes de accesibilidad (`design/assets/ui.css`, `design/assets/tokens.css`).

### ⚠️ Problemas encontrados
Ordenados de mayor a menor impacto:

1. **El portal sigue siendo pequeño para su audiencia principal** — `design/assets/tokens.css: --text-base/--text-md`, `design/assets/portal.css: body.portal`, `.portal .tab`, `.portal .ledger`
   - Aunque el portal sube a `0.9375rem`/`15px`, gran parte de la interfaz queda en 14–15px; labels y metadatos siguen usando `--text-xs` (12px). Esto contradice parcialmente la intención declarada de ayudar a residentes mayores y hace que deuda, fechas y estados sean más difíciles de escanear.
   - Mejora concreta: definir tokens de tamaño del portal (mínimo 16px para body y 14px para metadata) y aplicarlos a `.portal .ledger td`, `.portal .notice p`, `.portal .month__name` y labels; mantener 12px solo para información secundaria no accionable.

2. **La acción primaria de pago/carga no queda garantizada como primera decisión visual** — `design/assets/portal.css: .due`, `.steps`, `.upload`
   - La tarjeta `.due` comunica el importe, pero la regla CSS no establece una acción primaria dentro de ella; el flujo puede continuar con dos `.step` antes de que el usuario encuentre `.upload`. Para alguien que pregunta “¿tengo que pagar algo?”, el siguiente paso debería ser inequívoco.
   - Mejora concreta: reservar dentro de `.due` un bloque de acción con `.btn--lg` y texto explícito (“Subir comprobante”/“Ver cómo pagar”), y relegar `.steps` a una explicación posterior; usar una sola acción primaria por estado.

3. **Hay colores de estado hardcodeados fuera del sistema de tokens** — `design/assets/ui.css: .collection-bar .seg-revision`, `.toast::before`, `.toast--warn::before`; `design/assets/admin-sections.css: .concept__fill--owner`; `design/assets/portal.css: .due--revision`
   - `#d9a441`, `#8a6d3b`, `#7fd1a0`, `#f0a79f` y otros valores no tienen token equivalente. Esto permite que badges, barras, tarjetas y toasts diverjan con el tiempo y dificulta revisar contraste/tema de forma centralizada.
   - Mejora concreta: agregar tokens semánticos (`--review-strong`, `--owner`, `--toast-success`, `--toast-warning`) en `tokens.css` y sustituir cada literal; hacer que `.due--revision` use el mismo color que `.status--revision` y la barra de revisión.

4. **La diferenciación de estados depende demasiado de color** — `design/assets/ui.css: .status`, `.collection-bar > span`; `design/assets/portal.css: .due--moroso/.due--revision/.due--pagado`
   - El punto de color y el fondo suave distinguen estados en condiciones normales, pero el color no es suficiente para daltonismo, impresión o pantallas con contraste reducido. En el portal, el borde izquierdo cambia de color sin una señal estructural equivalente.
   - Mejora concreta: mantener el texto explícito en todos los estados, añadir icono o patrón/leyenda no cromática a barras, y no comunicar “pagado”, “en revisión” o “moroso” solo mediante `.due`/borde.

5. **El encabezado de la tabla usa contraste y tamaño demasiado ajustados** — `design/assets/ui.css: .ledger th`
   - El encabezado está en 11px, uppercase y `--ink-3`; es eficiente pero pesado para lectura sostenida y puede perderse frente a las cifras. En el portal esto se suma a celdas pequeñas.
   - Mejora concreta: subir encabezados a 12px, usar `--ink-2` o un token específico de texto de tabla y reducir ligeramente el tracking; reservar uppercase para labels muy cortos.

6. **El espaciado del admin es menos denso de lo que pide un CRM en vistas clave** — `design/assets/admin.css: .section`, `.building-row`; `design/assets/admin-sections.css: .comms__head`, `.comms__body`, `.notice-grid`
   - Se combinan padding horizontal de 32px con filas de edificios de 20px verticales y paneles de 24–32px. El resultado es sobrio, pero muestra menos contexto por viewport que una bandeja CRM; la vista de comunicaciones tiene además `min-height: 560px`.
   - Mejora concreta: bajar secciones operativas a 20–24px horizontales/verticales, filas a 12–16px verticales y reducir el mínimo de `.comms` a una altura basada en viewport; conservar el aire solo en encabezados y formularios.

7. **Hay una inconsistencia de marca entre sidebar y portal** — `design/assets/admin.css: .side`, `.side__header`; `design/assets/ui.css: .brand`
   - El admin define `.side__header` pero lo oculta y el HTML inicial solo contiene un sidebar vacío; la marca compartida `.brand` no tiene una garantía visible en esa superficie. El portal sí depende de `.portal-top .brand`. Esto puede dejar al admin sin identificación de producto/edificio si el render dinámico no inserta la marca correctamente.
   - Mejora concreta: establecer un bloque de marca visible y consistente en el sidebar (`.side__header` o `.brand`) y verificar que el estado móvil conserve nombre de empresa y contexto del edificio.

8. **El focus ring puede quedar recortado o ser difícil de percibir en controles compactos** — `design/assets/ui.css: :focus-visible`, `.icon-btn`, `.btn`; `design/assets/admin.css: .nav-item`
   - El anillo se aplica como `box-shadow` sobre controles de 30–32px y sobre navegación pegada al borde; no hay `outline-offset`, por lo que puede confundirse con bordes vecinos o quedar visualmente pegado al contenedor.
   - Mejora concreta: usar `outline: 2px solid var(--brand)` con `outline-offset: 2px` (o reservar espacio equivalente), y comprobar específicamente nav, chips, tabs, botones de icono y upload.

9. **Los shells HTML no ofrecen fallback funcional ni permiten validar la jerarquía real** — `design/admin.html`, `design/portal-residente.html`
   - Ambos documentos contienen solo `<aside>`, `.sheet` o `[data-portal]`; todo el contenido se genera por JavaScript. Además, los scripts solicitados en la tarea (`design/admin-views.js` y `design/portal.js`) no están en esas rutas. Sin el render final no se puede confirmar que la acción principal, estados, labels y orden de lectura evaluados arriba aparezcan realmente.
   - Mejora concreta: corregir la documentación/rutas del audit para apuntar a los scripts reales, o incluir un fixture estático mínimo para revisión visual; asegurar también un fallback de carga/error que no deje una pantalla vacía.

### 💡 Mejoras sugeridas (no críticas)
- `design/assets/tokens.css`: agregar tokens para `--text-portal`, `--text-table-heading`, `--state-review-strong` y colores de feedback; evitar nuevos literales de color.
- `design/assets/portal.css: .portal-top`, `.portal-main`: considerar `max-width` de 960px solo si las tablas necesitan más columnas; priorizar ancho de texto legible y no aumentar el ancho de párrafos.
- `design/assets/portal.css: .months`: añadir un indicador textual visible de mes seleccionado además de `aria-pressed`, para que el estado sobreviva a baja percepción de color.
- `design/assets/admin.css: .nav-item`: aumentar el área vertical a al menos 40px en el breakpoint móvil, donde la navegación se usa táctilmente.
- `design/assets/ui.css: .toast`: incluir un rol/estado visual consistente y no depender únicamente del punto verde/rojo para éxito o advertencia.
- `design/assets/portal.css: @media print`: reemplazar `#fff`/`#999` por tokens de impresión o documentar explícitamente esos valores como excepción de salida en blanco y negro.

## Cómo lo verifiqué
- Revisé los tokens y todos los selectores de layout, tablas, estados, formularios, navegación, foco y responsive en los CSS disponibles.
- Comparé la composición de admin (`220px` de sidebar, secciones de `24–32px`, tablas de `8px`) con la dirección CRM densa.
- Revisé los breakpoints de portal (`640px`) y los tamaños declarados para body, labels, campos, botones y acciones de carga.
- Verifiqué las rutas de scripts declaradas en ambos HTML; las rutas `design/admin-views.js` y `design/portal.js` no existen.

## Preguntas / pedidos al orquestador
- Confirmar si el audit debe leer `design/assets/admin-views.js` y `design/assets/portal.js` (las rutas que realmente parecen corresponder a los `<script src>`), ya que las rutas listadas en la tarea no existen.

ESTADO: listo
