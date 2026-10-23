# Tarea: crm-look — rediseño estilo CRM utilitario

## Objetivo
El diseño actual se ve como un dashboard de marketing: sidebar navy dramático,
números enormes, alto contraste. Se necesita el look de software de trabajo real
(Salesforce, HubSpot, Zoho): sidebar claro, tipografía densa y pequeña, sin drama,
todo funcional y utilitario.

## Archivos tuyos
- `design/assets/tokens.css`
- `design/assets/admin.css`
- `design/assets/ui.css`
- `design/assets/portal.css`

No toques los archivos `.js` ni los `.html`.

---

## 1. `tokens.css` — reemplazar TODO el bloque `:root`

```css
:root {
  /* Superficies — gris muy claro, casi blanco */
  --paper:      #f3f5f7;
  --paper-deep: #eaecf0;
  --sheet:      #ffffff;
  --sheet-sunk: #f8f9fa;
  --line:       #e1e4e8;
  --line-strong: #c8ced6;

  /* Tinta */
  --ink:        #1a1d23;
  --ink-2:      #444b56;
  --ink-3:      #6b7280;
  --ink-4:      #9ca3af;
  --ink-inverse: #ffffff;

  /* Marca: navy solo como acento */
  --brand:      #1e3a5f;
  --brand-hover: #162e4d;
  --brand-soft: #e8eef5;
  --side-ink:   #5a7a9e;
  --side-ink-2: #2d4a6b;
  --side-active: #e8eef5;
  --side-hover:  #f0f4f8;

  /* Estado de cuenta */
  --paid:        #2d6a4f;
  --paid-soft:   #f0f7f3;
  --review:      #7c5a1e;
  --review-soft: #faf5ec;
  --pending:     #5d6068;
  --pending-soft: #f4f4f5;
  --overdue:     #8b2020;
  --overdue-soft: #fdf2f2;

  /* Tipografía */
  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;

  /* Escala tipográfica — más pequeña, más densa */
  --text-2xs:  0.6875rem;
  --text-xs:   0.75rem;
  --text-sm:   0.8125rem;
  --text-base: 0.875rem;
  --text-md:   0.9375rem;
  --text-lg:   1.125rem;
  --text-xl:   1.375rem;
  --text-display: 1.75rem;

  /* Espaciado */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px;
  --s-12: 48px; --s-16: 64px;

  /* Forma — redondeado suave, no cero */
  --radius-sm: 3px;
  --radius:    4px;
  --radius-lg: 6px;

  /* Sombras mínimas */
  --shadow-sheet: 0 1px 3px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.04);
  --shadow-pop:   0 4px 12px rgb(0 0 0 / 0.1), 0 2px 4px rgb(0 0 0 / 0.06);
  --focus-ring: 0 0 0 2px rgb(30 58 95 / 0.25);

  /* Movimiento */
  --duration-fast:   100ms;
  --duration-normal: 180ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 2. `admin.css` — sidebar claro, layout compacto

**`.app`**:
```css
.app {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 100vh;
}
```

**`.side`** — sidebar claro, con borde derecho:
```css
.side {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: var(--s-4) 0 var(--s-4);
  background: var(--sheet);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
```

**`.side__header`** — si existe, eliminar la regla (o dejarla vacía):
```css
.side__header { display: none; }
```

**`.side__label`** — label de sección pequeño y discreto:
```css
.side__label {
  padding: var(--s-4) var(--s-3) var(--s-1);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
}
```

**`.nav-item`** — ítem de navegación compacto y funcional:
```css
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  width: 100%;
  padding: 7px var(--s-3);
  border: 0;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: 400;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
```

**`.nav-item svg`**:
```css
.nav-item svg {
  width: 16px;
  height: 16px;
  color: var(--ink-4);
}
```

**`.nav-item:hover`**:
```css
.nav-item:hover {
  background: var(--side-hover);
  color: var(--ink);
  border-left-color: transparent;
}
```

**`.nav-item[aria-current='page']`**:
```css
.nav-item[aria-current='page'] {
  background: var(--side-active);
  color: var(--brand);
  border-left-color: var(--brand);
  font-weight: 600;
  box-shadow: none;
}
.nav-item[aria-current='page'] svg {
  color: var(--brand);
}
```

**`.nav-building__addr`**:
```css
.nav-building__addr {
  font-size: var(--text-xs);
  color: var(--ink-3);
}
```

**`.pill-count`**:
```css
.pill-count {
  background: var(--review-soft);
  color: var(--review);
  font-size: var(--text-2xs);
  font-weight: 600;
}
```

**`.side__foot`**:
```css
.side__foot {
  margin-top: auto;
  display: grid;
  gap: 2px;
  padding-top: var(--s-4);
  border-top: 1px solid var(--line);
}
```

**`.side__user`**:
```css
.side__user {
  padding: var(--s-2) var(--s-3);
  font-size: var(--text-xs);
  color: var(--ink-3);
}
```

**Eliminar las reglas `.side .brand__mark`, `.side .brand__name`, `.side .brand__sub`**
si existen — el brand en sidebar claro no necesita inversión de color.

**`.main`**:
```css
.main {
  padding: 0;
  min-width: 0;
  background: var(--paper);
}
```

**`.sheet`** — panel principal plano:
```css
.sheet {
  min-height: 100vh;
  background: var(--sheet);
  border-radius: 0;
  box-shadow: none;
  border-left: 1px solid var(--line);
}
```

**`.page-head`**:
```css
.page-head {
  padding: var(--s-5) var(--s-6) 0;
  background: var(--sheet);
  border-bottom: 1px solid var(--line);
}
```

**`.page-title`** — título moderado, no enorme:
```css
.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
```

**`.figure`** — celda de KPI compacta:
```css
.figure {
  padding: var(--s-4) var(--s-6);
  border-right: 1px solid var(--line);
}
```

**`.figure__value`** — número de KPI de tamaño normal, no gigante:
```css
.figure__value {
  margin-top: var(--s-1);
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
```

---

## 3. `ui.css` — componentes más pequeños y densos

**`.btn`**:
```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  height: 30px;
  padding: 0 var(--s-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--sheet);
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}
```

**`.btn--primary`**:
```css
.btn--primary {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--ink-inverse);
  box-shadow: none;
}
```

**`.ledger th`** — header de tabla denso:
```css
.ledger th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 7px var(--s-3);
  background: var(--paper);
  border-bottom: 1px solid var(--line-strong);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: left;
  white-space: nowrap;
}
```

**`.ledger td`**:
```css
.ledger td {
  padding: 8px var(--s-3);
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
  font-size: var(--text-sm);
}
```

---

## 4. `portal.css` — portal más funcional

**`.due`**:
```css
.due {
  padding: var(--s-6);
  border-left: 3px solid var(--pending);
  border-radius: var(--radius);
  background: var(--sheet);
  box-shadow: var(--shadow-sheet);
}
```

**`.due__amount`** — importe legible pero no dramático:
```css
.due__amount {
  margin: var(--s-2) 0 var(--s-1);
  font-family: var(--font-mono);
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
```

---

## Resultado esperado
- Sidebar blanco con borde derecho gris, nav items con borde izquierdo navy cuando activo
- Fondo general gris muy claro (casi blanco)
- Tipografía pequeña y densa — se parece a Salesforce o HubSpot
- KPIs de tamaño normal, no titulares
- Sin sombras dramáticas
- Todo funcional, nada decorativo
