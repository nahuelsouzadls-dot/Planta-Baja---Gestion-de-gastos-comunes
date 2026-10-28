# Front — Administración GC

App React del panel de administración, el portal del residente y las pantallas de acceso (ADR-0018).

- **Stack:** React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui (`src/components/ui/`), TanStack Query y React Router.
- **Diseño:** reglas del cliente en `../design/DISENO.md`; tokens en `src/index.css`.
- **Datos:** `src/lib/api.ts` (sesión + CSRF, mismo origen) y `src/features/*/data.ts`. Los montos llegan como texto y no se calculan acá (ADR-0011).

```bash
npm ci
npm run dev     # http://localhost:5173, le pasa /api a Django en :8000
npm run build   # verifica tipos y genera dist/, que Django sirve en /static/app/
```

| Carpeta | Qué tiene |
|---|---|
| `src/app/` | Sesión y control de acceso por rol |
| `src/features/auth/` | Ingresar, recuperar y restablecer contraseña, aceptar invitación |
| `src/features/portal/` | Portal del residente |
| `src/features/panel/` | Panel de administración |
| `src/components/` | Componentes de shadcn/ui y compartidos |
| `src/lib/` | API, formato, tipos y utilidades |
