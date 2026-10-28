# ADR-0018: El front pasa a React + shadcn/ui, compilado y servido por Django

- **Estado:** Aceptada (Nahuel, 2026-10-27)
- **Fecha:** 2026-10-27
- **Reemplaza a:** [ADR-0002](0002-front-estatico-js-puro.md)

## Contexto
El ADR-0002 mantuvo el front del handoff en JS puro (`design/`), con vistas que arman HTML como texto. Con el panel y el portal conectados a la API, ese código creció (unas 3500 líneas de JS sin tipos) y cada mejora visual costaba cada vez más. Nahuel pidió modernizar el aspecto con componentes actuales, **manteniendo la dirección visual aprobada por el cliente** (`design/DISENO.md`), y autorizó rediseñar las pantallas de acceso.

## Decisión
- El front es una app **React 19 + TypeScript** en `frontend/`, compilada con **Vite**.
- Estilos con **Tailwind CSS v4**; componentes de **shadcn/ui** (copiados en `src/components/ui/`, sobre `radix-ui`). Los tokens de `DISENO.md` (grises, radio 12, los 5 temas tipo Slack, colores de estado, vidrio líquido) viven en `src/index.css` con la convención de nombres de shadcn.
- Datos con **TanStack Query** (caché, reintentos, recarga después de escribir); rutas con **React Router**; avisos con **sonner**; íconos **lucide**.
- **Se conserva todo lo que el ADR-0002 resolvía bien:**
  - **Mismo origen:** Django sirve el `index.html` del build en cada pantalla y el resto como estáticos en `/static/app/`. La cookie de sesión y el CSRF siguen igual ([ADR-0005](0005-sesiones-y-csrf.md)); no hay CORS.
  - El control de acceso por rol sigue en `apps/frontend/views.py` (quien no corresponde va a su inicio o al login antes de bajar la app), y el front lo repite para navegar sin recargar.
  - Los montos llegan como texto y los calcula el backend ([ADR-0011](0011-dinero-decimal-y-redondeo.md)). El front solo los formatea; la única cuenta en el cliente es la vista previa del prorrateo, que no se envía.
- En desarrollo, `make front-dev` levanta Vite en `:5173` con recarga en vivo y le pasa `/api` a Django (reescribe `Origin`/`Referer` para el CSRF). `make front-build` genera `frontend/dist`, que Django sirve en `:8000`.
- La imagen de producción compila el front en una etapa de Node y copia solo `dist/`.

## Alternativas descartadas
- **Seguir con JS puro y pulir el CSS:** no resolvía el costo de mantener vistas como texto sin tipos.
- **Next.js separado:** otro deploy, CORS y sesión entre dominios; no aporta nada a una app detrás de login.
- **Django templates + HTMX:** obligaba a reescribir igual todas las pantallas y alejaba al front de la API que ya está hecha.

## Consecuencias
- Hay un paso de compilación: el CI suma un job que verifica tipos y compila (`npm run build`).
- Los tests de `apps/frontend` usan un build mínimo de prueba y no dependen de Node.
- Las pantallas de acceso dejan la foto de fondo: panel de marca con el color del tema y vidrio líquido, y el formulario sobre fondo claro con los mismos componentes que el resto.
- `design/` queda como referencia del diseño aprobado (`DISENO.md`, `ref/`). El JS y el HTML viejos ya no se sirven y se pueden borrar.
