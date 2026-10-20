# Guía de Roles de Agentes — Cuándo Usar Cada Uno

Este documento es para Nahuel. Te ayuda a decidir qué agente invocar según lo que necesitás hacer en cada momento del proyecto.

---

## Los 4 Agentes y Sus Usos

| Agente | Archivo | Usalo cuando... |
|---|---|---|
| Tutor | `agent-tutor.md` | Querés entender algo antes de implementarlo, o te quedaste trabado y querés aprender el por qué |
| Implementador Backend | `agent-implementador.md` | Tenés que escribir código Django: modelos, migraciones, vistas, lógica de negocio |
| Diseñador de Pantallas | `agent-disenador.md` | Necesitás diseñar cómo va a verse y funcionar una pantalla antes de implementarla |
| Revisor Técnico | `agent-revisor.md` | Terminaste de implementar algo y querés una segunda opinión antes de seguir |

---

## Flujo Recomendado por Tarea

Para cada feature o módulo del proyecto, el orden ideal es:

```
1. TUTOR      → Entendé el concepto antes de empezar
2. DISEÑADOR  → Diseñá la pantalla / flujo
3. TUTOR      → Aclará dudas del diseño si aparecen
4. IMPLEMENTADOR → Escribí el código
5. TUTOR      → Entendé partes del código que no quedaron claras
6. REVISOR    → Auditá antes de dar por terminado
```

No es obligatorio seguir todos los pasos para features simples. Un CRUD básico puede ir directo al implementador. Pero para los flujos críticos (prorrateo, validación de pagos, ledger), seguí el orden completo.

---

## Ejemplos Concretos

### "Quiero implementar la carga de gastos mensuales"
1. **Tutor:** "Explicame qué es un `GastoMensual` y cómo se relaciona con los apartamentos"
2. **Diseñador:** "Diseñame la pantalla de carga de gastos para Confort S.A."
3. **Implementador:** "Implementá el modelo `GastoMensual` con sus items y la vista para crearlo"
4. **Revisor:** "Revisá este modelo y esta vista. ¿Los decimales están bien? ¿Hay validaciones faltantes?"

### "No entiendo por qué se usa UUID como PK"
→ **Tutor** directamente.

### "Necesito el wireframe del portal del residente"
→ **Diseñador** directamente.

### "Implementé la validación de pagos, ¿está bien?"
→ **Revisor** directamente, pegando el código.

### "¿Qué pasa si dos admins validan el mismo comprobante al mismo tiempo?"
→ **Tutor** para entender el problema, luego **Revisor** para verificar que el código lo maneje.

---

## Cómo Invocar un Agente

En Claude Code, pegá el contenido del archivo `.md` del agente al inicio de tu prompt, o pasalo como contexto. Por ejemplo:

```
[Pegá el contenido de agent-tutor.md]

---
Mi pregunta: ¿Por qué el ledger es append-only y no simplemente actualizo el saldo?
```

O si usás Claude con archivos adjuntos, adjuntá el `.md` del agente correspondiente.

---

## Agentes que Podés Agregar Después

A medida que el proyecto crezca, estos agentes van a ser útiles:

| Agente | Cuándo agregarlo |
|---|---|
| **Redactor de Tests** | Cuando empieces a escribir tests unitarios y de integración (recomendado desde Fase 2) |
| **DevOps / Infra** | Cuando necesites configurar Docker, Railway, Render, o el pipeline de CI/CD |
| **Documentador** | Cuando necesites generar documentación de API (OpenAPI) o manuales de usuario para Confort S.A. |
| **Migrador de Datos** | Para el "Día Cero": importar los saldos iniciales desde el Excel de Confort S.A. |

---

## Nota sobre el Aprendizaje

Si tu objetivo es aprender mientras construís (que es el caso), el **Tutor** es el agente más importante. Usalo más de lo que creés necesario.

Una regla práctica: si el implementador te da código que no entendés al 100%, antes de seguir, invocá al tutor con ese código y preguntale "¿por qué está escrito así?". Ese momento de fricción vale más que avanzar rápido.
