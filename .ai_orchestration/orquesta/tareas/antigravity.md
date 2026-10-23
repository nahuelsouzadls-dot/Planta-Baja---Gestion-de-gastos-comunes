# Tarea: audit-design — auditoría del diseño actual

## Tu rol
Sos el auditor / juez de diseño. No modificás archivos de la interfaz.
Tu trabajo es leer el estado actual, evaluarlo con criterio profesional y
producir un reporte con problemas concretos y mejoras priorizadas.

## Archivos que podés leer (solo lectura)
- `design/admin.html`
- `design/portal-residente.html`
- `design/assets/tokens.css`
- `design/assets/admin.css`
- `design/assets/admin-sections.css`
- `design/assets/ui.css`
- `design/assets/portal.css`
- `design/assets/admin-views.js`
- `design/assets/portal.js`

## Solo podés escribir
- `orquesta/reportes/antigravity.md` (tu reporte)

---

## Contexto del producto

Sistema SaaS de gestión de consorcios (edificios de propiedad horizontal) para una
administradora en Montevideo, Uruguay. El panel admin lo usa el personal de Confort S.A.
El portal lo usan los residentes (incluye personas mayores con poca experiencia digital).

**Dirección de diseño pedida:** look CRM serio y corporativo — estilo Salesforce/HubSpot.
Sin decoración, funcional, denso, tipografía pequeña, sidebar claro con acento navy.

---

## Qué evaluar

### 1. Consistencia del sistema de tokens
- ¿Los tokens de color se usan correctamente en todo el CSS?
- ¿Hay valores hardcodeados que deberían ser variables?
- ¿Los colores de estado (paid/review/overdue) siguen siendo distinguibles con la paleta actual?

### 2. Jerarquía visual y legibilidad
- ¿Hay suficiente contraste entre los niveles de texto?
- ¿Los tamaños tipográficos crean jerarquía clara?
- ¿Los headers, subheaders y body text se distinguen bien?

### 3. Densidad de información (CRM)
- ¿El espaciado es apropiado para un CRM? ¿Hay demasiado padding o demasiado poco?
- ¿Las tablas se ven densas y funcionales o aireadas y decorativas?
- ¿Cuántas filas se pueden ver sin hacer scroll? (estimado)

### 4. Componentes problemáticos
- ¿Qué componentes se ven fuera de tono con el look CRM pedido?
- ¿Hay elementos que todavía se ven "caricaturescos" o demasiado diseñados?
- ¿Hay inconsistencias entre el panel admin y el portal?

### 5. Portal de residentes
- ¿La interfaz es usable para personas mayores?
- ¿El texto es suficientemente grande?
- ¿La acción principal (pagar / subir comprobante) es obvia?

---

## Formato del reporte

Escribí `orquesta/reportes/antigravity.md` con este formato:

```markdown
# Reporte: antigravity — audit-design

## Hecho
- Leí los archivos listados en la tarea.

## Hallazgos

### ✅ Lo que funciona bien
- (lista)

### ⚠️ Problemas encontrados
Ordenados de mayor a menor impacto:

1. **[Nombre del problema]** — [archivo:selector]
   - Descripción del problema
   - Mejora concreta: cambiar X por Y

2. ...

### 💡 Mejoras sugeridas (no críticas)
- (lista con archivo y selector específico)

## Cómo lo verifiqué
- (qué revisaste)

## Preguntas / pedidos al orquestador
- (o "ninguna")

ESTADO: listo
```

Sé específico: cada problema debe incluir el archivo, el selector CSS y la mejora concreta.
