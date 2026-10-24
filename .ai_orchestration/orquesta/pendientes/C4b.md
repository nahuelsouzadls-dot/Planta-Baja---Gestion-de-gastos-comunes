# Tarea: C4b — Panel de administración conectado a la API

## Contexto
C4a sirve el front y maneja la sesión. Ahora el panel (`design/admin.html`) deja de leer el `localStorage` y usa la API del panel (C3a lectura y C3b escritura; contrato en `/api/v1/docs`, solo para empleados).

**El diseño no cambia.** Las vistas de `admin-views.js` y `admin-panels.js` son funciones `(datos, vista) → HTML`: adaptá **la fuente de los datos**, no el markup. Si una vista necesita un dato que la API no trae, **pedilo en el reporte** en vez de calcularlo en el front (los cálculos de dinero viven en el backend, ADR-0011).

## Qué cambia
- `admin.js`: cada ruta (`#/` cartera, `#/edificio/:id/:tab`) pide su endpoint (`portfolio`, `accounts`, `summary`, `settlements`, `notices`, `claims`, `tasks`) y renderiza con la respuesta. Estado de carga y de error (con el mensaje de la API) en el mismo estilo del diseño.
- La organización activa: si el empleado tiene más de una, un selector en la barra superior (lista de `GET /api/v1/organizations`); si tiene una, no se muestra.
- Acciones: aprobar y rechazar comprobante (con el diálogo actual y el checklist), cargar y emitir gastos (el diálogo usa los conceptos del edificio que devuelve la API, no la lista fija del front), pagos manuales, ajustes, ocupantes, avisos, reclamos y tareas: cada una llama a su endpoint de C3b y vuelve a pedir la pantalla.
- La ficha de unidad y el diálogo del comprobante usan `occupancies/{id}` y `receipts/{id}`; "Ver comprobante" abre la URL firmada de `receipts/{id}/file` (D1).
- "Exportar a Excel" usa el endpoint de D5 cuando exista; mientras tanto, queda deshabilitado con un `title` que lo explique.
- `ledger.js` y `data.js` dejan de cargarse en `admin.html`.

## Archivos tuyos
`design/assets/admin.js`, `admin-views.js`, `admin-panels.js`, `design/admin.html` (solo los `<script>`).

## Tests
- Playwright (de C4a) con la demo cargada: la cartera muestra $ 73.830 / $ 42.025 / $ 11.035 / $ 18.120 (redondeado en pantalla como hoy) y los 4 comprobantes; aprobar el de María García desde la cola actualiza la cartera; emitir un borrador de noviembre en un edificio de prueba crea la liquidación.
- Ningún `parseFloat`/`Number(...)` sobre montos que se mandan a la API (revisalo con un `grep` en el reporte).
- Capturas de cada pantalla comparadas contra `design/ref/capturas/` (mismas a simple vista).
