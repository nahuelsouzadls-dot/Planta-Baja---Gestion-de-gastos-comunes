# Documentación técnica

| Documento | Qué tiene |
|---|---|
| [`modelo-datos.md`](modelo-datos.md) | **Especificación aprobada** del modelo: decisiones de negocio, entidades, reglas de cálculo, seguridad y plan de microtareas B0–B9. |
| [`arquitectura/vista-general.md`](arquitectura/vista-general.md) | Contexto, contenedores, capas de Django, aislamiento multi-tenant y despliegue. |
| [`arquitectura/uml-clases.md`](arquitectura/uml-clases.md) | Diagramas de clases por módulo y servicios de dominio. |
| [`arquitectura/secuencias.md`](arquitectura/secuencias.md) | Flujos críticos: emitir liquidación, pagos con y sin comprobante, mudanza, venta, invitación, login. |
| [`arquitectura/estados.md`](arquitectura/estados.md) | Ciclos de vida: liquidación, comprobante, ocupación, estado de cuenta, reclamo, invitación. |
| [`arquitectura/almacenamiento.md`](arquitectura/almacenamiento.md) | Dónde y cómo se guarda cada dato: tablas, restricciones, triggers, R2, datos personales y backups. |
| [`adr/`](adr/README.md) | Registro de decisiones de arquitectura (una por archivo). |
| `golden/` | Valores de referencia sacados del front para los tests del backend (los genera agy). |

Los diagramas están en Mermaid: GitHub los muestra directamente. Se validaron con Mermaid 10.9.1.
