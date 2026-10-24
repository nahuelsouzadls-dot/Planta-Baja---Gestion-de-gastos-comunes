# ADR-0016: Cuentas nominativas y log consultable de quién hizo cada cosa

- **Estado:** Aceptada
- **Fecha:** 2026-10-24
- **Complementa a:** [ADR-0015](0015-registro-de-cambios-en-la-base.md)

## Contexto
Nahuel: "La idea es generar usuarios admin: María de Confort, Pablo de Confort […] que tengan su registro en todo lo que hacen, como log". Y aclaró: "un log, si se quiere consultar quién hizo cada cosa o movimiento; no tiene que ser algo automático ni que se muestre en la pantalla".

El log ya existe por ADR-0015 (`audit_rowchange`, escrito por triggers de Postgres). Pero ese log solo sirve si **cada persona tiene su propia cuenta**: si todos entran con el mismo usuario, el log dice "Confort S.A." y no a quién.

## Decisión
**1. Cuentas nominativas, nunca compartidas.**
- Cada empleado de la administradora es un `User` propio, con su nombre y su email personal (`maria@confort.com.uy`), ligado a la organización por `OrgMembership`.
- No se crean cuentas genéricas (`admin@confort`, `administracion@…`). El alta de empleados es **por invitación**, igual que la de residentes (microtarea C1), y queda en el log quién invitó a quién.
- Un empleado que se va **se desactiva, no se borra**: su nombre sigue en el log de todo lo que hizo.
- El superusuario de Django es solo para el equipo que mantiene el sistema; los empleados entran al panel, no al admin de Django.

**2. Un log para consultar, no para mostrar.**
- La fuente es `audit_rowchange` (ADR-0015): cada alta, cambio o baja con antes, después, empleado, ruta y fecha. Más los eventos de negocio de `AuditLog` (ADR-0013), que lo resumen en una línea ("aprobó el comprobante X").
- Se consulta **cuando hace falta**: por empleado, por fecha, por edificio o por registro ("¿quién cambió el coeficiente de la 302?", "¿qué hizo Pablo el 21 de octubre?", "¿quién registró este pago?").
- En el MVP se consulta desde el admin de Django (filtros por tabla, operación, empleado y fecha). Si más adelante la administradora quiere consultarlo ella misma, se agrega una pantalla de "Actividad" en el panel; no es parte del MVP.
- No hay alertas automáticas ni firmas en pantallas o PDFs.

## Alternativas descartadas
- **Una cuenta por administradora:** el log no podría decir quién hizo qué.
- **Mostrar la autoría en cada pantalla y PDF:** Nahuel lo descartó; no hace falta para el control que se busca.

## Consecuencias
- Los campos que ya identifican al responsable en el modelo (`issued_by`, `reviewed_by`, `created_by`) se mantienen porque son parte del dato, pero no hay requisito de mostrarlos.
- **Segundo factor (2FA): no por ahora** (decisión de Nahuel, 2026-10-24). El acceso de empleados queda con contraseña Argon2 y bloqueo por intentos (ADR-0005). Como el log depende de que nadie use la cuenta de otro, 2FA queda como la primera mejora de seguridad a revisar antes de sumar más administradoras; el modelo de usuario lo admite sin cambios.
