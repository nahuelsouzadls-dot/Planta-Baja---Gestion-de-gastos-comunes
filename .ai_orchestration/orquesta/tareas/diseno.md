# Tarea: redesign-corporate — rediseño visual "serio y corporativo"

## Objetivo
El prototipo actual tiene un look "libro mayor cálido" (fondo crema, tonos papel).
Hacerlo más serio y corporativo: paleta fría-neutra, sidebar navy con identidad propia,
radios más rectos, headers de tabla con peso tipográfico. Sin cambiar estructura ni JS.

## Archivos tuyos
- `design/assets/tokens.css`
- `design/assets/admin.css`
- `design/assets/ui.css`
- `design/assets/portal.css`

No toques `design/assets/*.js`, ni los `.html`, ni ningún archivo fuera de `design/`.

---

## Cambios exactos

### 1. `design/assets/tokens.css`

**Superficies — de papel cálido a gris frío-neutro:**
```
--paper:      #f3f0e8  →  #f0f3f7
--paper-deep: #e9e4d8  →  #e6eaf0
--sheet-sunk: #f8f6f1  →  #f5f7fa
--line:       #e6e1d6  →  #dde3ec
--line-strong:#d2cbbb  →  #c8d0dc
--brand-soft: #e7edf5  →  #e4eaf5
```

**Forma — radios más rectos:**
```
--radius-sm: 4px   →  3px
--radius:    8px   →  6px
--radius-lg: 14px  →  8px
```

**Sombras — más definidas, menos "floaty":**
```
--shadow-sheet: 0 1px 3px rgb(31 58 92 / 0.08), 0 1px 0 rgb(31 58 92 / 0.04)
--shadow-pop:   0 4px 6px rgb(31 58 92 / 0.08), 0 20px 40px -12px rgb(31 58 92 / 0.22)
```

**Tokens nuevos para sidebar (agregalos después de `--brand-soft`):**
```css
--side-ink:    #c8d8ec;
--side-ink-2:  #e8f0f8;
--side-active: rgba(255 255 255 / 0.12);
--side-hover:  rgba(255 255 255 / 0.07);
```

---

### 2. `design/assets/admin.css`

**`.side` — sidebar navy:**
Agregar `background: var(--brand);` a la regla `.side` existente.

**`.side__label`:**
```css
color: var(--side-ink);
```

**`.nav-item`:**
```css
color: var(--side-ink-2);
```
```css
.nav-item svg { color: var(--side-ink); }
```
```css
.nav-item:hover {
  background: var(--side-hover);
  color: #fff;
}
```
```css
.nav-item[aria-current='page'] {
  background: var(--side-active);
  color: #fff;
  box-shadow: none;
}
.nav-item[aria-current='page'] svg { color: #fff; }
```

**`.nav-building__addr`:**
```css
color: var(--side-ink);
```

**`.pill-count`:**
```css
background: rgba(255 255 255 / 0.15);
color: #fff;
```

**`.side__foot`:**
```css
border-top-color: rgba(255 255 255 / 0.12);
```

**`.side__user`:**
```css
color: var(--side-ink);
```

**`.side .brand__mark`** (agregar regla nueva):
```css
.side .brand__mark {
  background: rgba(255 255 255 / 0.15);
  color: #fff;
}
```

**`.side .brand__name`** (agregar regla nueva):
```css
.side .brand__name { color: #fff; }
```

**`.side .brand__sub`** (agregar regla nueva):
```css
.side .brand__sub { color: var(--side-ink); }
```

---

### 3. `design/assets/ui.css`

**`.ledger th` — headers de tabla con más énfasis:**
Reemplazar la regla existente por:
```css
.ledger th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 10px var(--s-3);
  background: var(--sheet-sunk);
  border-bottom: 1px solid var(--line-strong);
  color: var(--ink-2);
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  text-align: left;
  white-space: nowrap;
}
```

**`.btn--primary`** — agregar sombra interior sutil:
```css
box-shadow: inset 0 1px 0 rgba(255 255 255 / 0.1);
```

---

### 4. `design/assets/portal.css`

**`.due` — reemplazar pseudo-elemento por border-left:**
- Quitá el `::before` de `.due` (width: 6px, etc.)
- Reemplazá con `border-left: 4px solid var(--pending);` en `.due`
- Agregá:
```css
.due--moroso  { border-left-color: var(--overdue); }
.due--revision{ border-left-color: #d9a441; }
.due--pagado  { border-left-color: var(--paid); }
```

---

## Cómo verificar
Abrí `design/admin.html` y `design/portal-residente.html` en el browser.

Checklist visual:
- [ ] Fondo general gris frío (no crema)
- [ ] Sidebar navy oscuro con texto legible en claro
- [ ] Item activo del sidebar con fondo semitransparente blanco
- [ ] Radios de botones y cards más rectos que antes
- [ ] Headers de tabla en uppercase pequeño
- [ ] Tarjeta "lo que debés" en el portal con borde izquierdo de color (no pseudo-elemento)

## Preguntas anticipadas
Si algo del selector no matchea exactamente con el CSS actual, buscá la regla más parecida y aplicá el cambio conservadoramente. Anotá en el reporte qué ajustaste.
