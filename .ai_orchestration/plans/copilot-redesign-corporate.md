# Prompt para Copilot: rediseño visual "corporate"

## Contexto

El prototipo en `design/` tiene un sistema de diseño "libro mayor cálido" —
fondo crema (`#f3f0e8`), tonos papel, sidebar que se confunde con el fondo.
El objetivo es desplazarlo hacia un look de SaaS empresarial serio:
paleta fría-neutra, sidebar con identidad propia (navy), radios más rectos.

Los archivos a modificar son **únicamente** los de `design/assets/`:
`tokens.css`, `ui.css`, `admin.css`, `portal.css`.
No toques los archivos `.js` ni el HTML.

---

## 1. `tokens.css` — cambios de tokens

### Superficies: de papel cálido a gris frío-neutro

```diff
- --paper:      #f3f0e8;
- --paper-deep: #e9e4d8;
- --sheet-sunk: #f8f6f1;
- --line:       #e6e1d6;
- --line-strong:#d2cbbb;
+ --paper:      #f0f3f7;
+ --paper-deep: #e6eaf0;
+ --sheet-sunk: #f5f7fa;
+ --line:       #dde3ec;
+ --line-strong:#c8d0dc;
```

`--sheet` (#ffffff) e `--ink-*` no cambian.

### Marca: el navy se mantiene, ajustar soft

```diff
- --brand-soft: #e7edf5;
+ --brand-soft: #e4eaf5;
```

Sin cambios en `--brand`, `--brand-hover`, ni en los colores de estado
(`--paid`, `--review`, `--overdue`, `--pending`).

### Forma: radios más rectos para look enterprise

```diff
- --radius-sm: 4px;
- --radius:    8px;
- --radius-lg: 14px;
+ --radius-sm: 3px;
+ --radius:    6px;
+ --radius-lg: 8px;
```

### Sombras: más definidas, menos "floaty"

```diff
- --shadow-sheet: 0 1px 0 rgb(23 24 27 / 0.04), 0 8px 28px -12px rgb(23 24 27 / 0.18);
- --shadow-pop:   0 2px 4px rgb(23 24 27 / 0.06), 0 24px 60px -18px rgb(23 24 27 / 0.35);
+ --shadow-sheet: 0 1px 3px rgb(31 58 92 / 0.08), 0 1px 0 rgb(31 58 92 / 0.04);
+ --shadow-pop:   0 4px 6px rgb(31 58 92 / 0.08), 0 20px 40px -12px rgb(31 58 92 / 0.22);
```

---

## 2. `admin.css` — sidebar navy

El cambio de mayor impacto visual: convertir el sidebar en navy (`--brand`),
igual al `brand__mark`. Todas las clases que viven dentro de `.side` necesitan
sus colores ajustados para contrastar sobre fondo oscuro.

### `.side`

```css
.side {
  background: var(--brand);   /* navy #1f3a5c */
  border-right: none;
}
```

Agregar al `:root` de `tokens.css` estos dos tokens auxiliares para el sidebar
(no reutilizar variables existentes — el sidebar tiene su propio sistema):

```css
--side-ink:    #c8d8ec;   /* texto apagado sobre navy */
--side-ink-2:  #e8f0f8;   /* texto normal sobre navy */
--side-active: rgba(255 255 255 / 0.12);  /* fondo item activo */
--side-hover:  rgba(255 255 255 / 0.07);  /* fondo item hover */
```

### `.side__label`

```css
.side__label {
  color: var(--side-ink);
}
```

### `.nav-item`

```css
.nav-item {
  color: var(--side-ink-2);
}

.nav-item svg {
  color: var(--side-ink);
}

.nav-item:hover {
  background: var(--side-hover);
  color: #fff;
}

.nav-item[aria-current='page'] {
  background: var(--side-active);
  color: #fff;
  box-shadow: none;
}

.nav-item[aria-current='page'] svg {
  color: #fff;
}
```

### `.nav-building`

```css
.nav-building__addr {
  color: var(--side-ink);
}
```

### `.pill-count` (notificaciones en sidebar)

```css
.pill-count {
  background: rgba(255 255 255 / 0.15);
  color: #fff;
}
```

### `.side__foot` y `.side__user`

```css
.side__foot {
  border-top-color: rgba(255 255 255 / 0.12);
}

.side__user {
  color: var(--side-ink);
}
```

### `.brand` dentro del sidebar

El `.brand__mark` ya es navy sobre navy — invertir:

```css
.side .brand__mark {
  background: rgba(255 255 255 / 0.15);
  color: #fff;
}

.side .brand__name {
  color: #fff;
}

.side .brand__sub {
  color: var(--side-ink);
}
```

---

## 3. `ui.css` — ajustes globales

### Botón primario: borde sutil para look más serio

```css
.btn--primary {
  box-shadow: inset 0 1px 0 rgba(255 255 255 / 0.1);
}
```

### `.status` badges: menos redondeados (ya cubierto por --radius changes)

No requiere cambio adicional; el `border-radius: 999px` en badges se mantiene
(sí es correcto para pills de estado).

### `.ledger th`: más énfasis en los headers de tabla

```css
.ledger th {
  background: var(--sheet-sunk);
  color: var(--ink-2);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  font-size: var(--text-2xs);
}
```

---

## 4. `portal.css` — ajustes portal de residentes

El portal hereda la paleta fría de `tokens.css` automáticamente.
Solo un ajuste puntual:

### `.due` (tarjeta de estado de pago): borde izquierdo más grueso

```diff
- width: 6px;
+ width: 4px;
```

Y reemplazar el pseudo-elemento por un `border-left` real en `.due`:

```css
.due {
  border-left: 4px solid var(--pending);
}

.due::before {
  display: none;
}

.due--moroso  { border-left-color: var(--overdue); }
.due--revision{ border-left-color: #d9a441; }
.due--pagado  { border-left-color: var(--paid); }
```

---

## Resultado esperado

| Antes | Después |
|-------|---------|
| Fondo crema (#f3f0e8) | Gris frío-neutro (#f0f3f7) |
| Sidebar papel (mismo tono que fondo) | Sidebar navy #1f3a5c con texto claro |
| Radios 8/14px | Radios 6/8px |
| Sombras grandes suaves | Sombras definidas y bajas |
| Headers de tabla grises apagados | Headers uppercase con énfasis |

El lenguaje visual pasa de "papelería de oficina" a "software de gestión empresarial".
IBM Plex Sans ya era la elección correcta — no cambia.
