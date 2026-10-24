# Tarea: C4c — Portal del residente conectado a la API

## Contexto
Igual que C4b, para `design/portal-residente.html`, con la API del portal (C3c) y la subida de comprobantes (D1). **El diseño no cambia.**

## Qué cambia
- El portal arranca pidiendo `GET /api/v1/auth/me` y toma las ocupaciones accesibles. Si hay más de una (N4: varias unidades), un selector arriba del saludo; si hay una, no se muestra.
- Bloque de pago: `account` (saludo, estado, saldo, vencimiento y **datos para transferir con "Copiar"**). Ex inquilino (`closed: true`): un aviso claro de que la unidad está cerrada y lo que queda por pagar.
- **Subir comprobante:** pedir la URL firmada (`receipts/upload`), subir el archivo directo al almacenamiento con el `POST` y sus `fields`, y enviar el comprobante (`portal/receipts`). Si la persona tiene más de una ocupación con deuda, el formulario pide el **reparto por unidad y una aclaración** (N12). Validá tipo y tamaño en el navegador antes de subir (lo mismo que valida el backend).
- Mi liquidación: el selector de mes con `months` y el detalle con `settlements/{YYYY-MM}`. "Imprimir o guardar PDF" usa el PDF de D4 cuando exista.
- Mis movimientos, Mis comprobantes (con "ver" por URL firmada), Avisos y Reclamos con sus endpoints.
- `ledger.js` y `data.js` dejan de cargarse en `portal-residente.html`.

## Archivos tuyos
`design/assets/portal.js`, `design/portal-residente.html` (solo los `<script>`).

## Tests
- Playwright con la demo: Juan Pérez ve $ 4.153,80 pendiente; María García ve "En revisión"; un residente sube un PNG y aparece "En revisión" en el portal y en la cola del panel.
- Subir un archivo de tipo no permitido o de más de 10 MB muestra el error sin llamar a la API.
- Capturas contra `design/ref/capturas/portal-*.png`.
