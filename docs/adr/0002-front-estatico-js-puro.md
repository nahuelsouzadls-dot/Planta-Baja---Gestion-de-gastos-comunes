# ADR-0002: El front es estático (JS puro) y consume la API

- **Estado:** Propuesta
- **Fecha:** 2026-10-23

## Contexto
El diseño final ya está hecho en HTML, CSS y JS puro (`design/`), con la lógica separada en `GC.store` y las vistas como funciones (estado → HTML). `CLAUDE.md` deja abierto si el portal se hace con Django templates o con un front separado.

## Decisión
Se mantiene ese front tal cual. Django lo sirve como archivos estáticos desde el mismo dominio y el front pasa a leer y escribir a través de la API (`/api/v1/`). Solo cambia `GC.store`: de `localStorage` a `fetch`.

## Alternativas descartadas
- Django templates: habría que reescribir todas las pantallas y se pierde el diseño ya validado.
- Next.js separado: otro deploy, CORS y autenticación entre dominios, y reescribir el front en React.

## Consecuencias
- Cero reescritura del diseño.
- Mismo origen: cookie de sesión y CSRF sin CORS ([ADR-0005](0005-sesiones-y-csrf.md)).
- Los montos los calcula el backend; el front solo los muestra ([ADR-0011](0011-dinero-decimal-y-redondeo.md)).
