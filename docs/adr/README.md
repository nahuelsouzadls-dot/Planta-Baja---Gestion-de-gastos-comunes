# Registro de decisiones de arquitectura (ADR)

Cada archivo documenta una decisión: el contexto, qué se decidió, qué se descartó y qué implica. Una decisión aceptada no se edita: si cambia, se escribe un ADR nuevo que la reemplaza.

| # | Decisión | Estado |
|---|---|---|
| 0001 | [Stack: Django + PostgreSQL + Celery + R2 en Railway](0001-stack-django-postgres.md) | Aceptada |
| 0002 | [El front es estático (JS puro) y consume la API](0002-front-estatico-js-puro.md) | Reemplazada por 0018 |
| 0003 | [Aislamiento multi-tenant por organización](0003-multi-tenant-por-organizacion.md) | Aceptada |
| 0004 | [Modelo de usuario propio con login por email](0004-usuario-propio-con-email.md) | Aceptada |
| 0005 | [Sesiones de Django con CSRF, sin JWT](0005-sesiones-y-csrf.md) | Aceptada |
| 0006 | [La cuenta corriente es la ocupación (persona + unidad + rol + período)](0006-cuenta-corriente-por-ocupacion.md) | Aceptada |
| 0007 | [Libro mayor append-only, garantizado por la base](0007-libro-mayor-append-only.md) | Aceptada |
| 0008 | [El pago es la verificación de la administración; el comprobante es evidencia](0008-pago-es-verificacion-humana.md) | Aceptada |
| 0009 | [La imputación de pagos (FIFO) se calcula al leer](0009-imputacion-fifo-calculada.md) | Aceptada |
| 0010 | [Conceptos de gasto configurables por edificio](0010-conceptos-configurables.md) | Aceptada |
| 0011 | [Dinero en Decimal, coeficientes como fracción y redondeo explícito](0011-dinero-decimal-y-redondeo.md) | Aceptada |
| 0012 | [Archivos en R2 privado con URLs firmadas](0012-archivos-en-r2-con-urls-firmadas.md) | Aceptada |
| 0013 | [Auditoría append-only de las acciones sensibles](0013-auditoria-append-only.md) | Aceptada |
| 0014 | [Migración día cero con asiento de apertura](0014-migracion-dia-cero.md) | Aceptada |
| 0015 | [Registro de cambios en la base: quién editó qué, con antes y después](0015-registro-de-cambios-en-la-base.md) | Aceptada |
| 0016 | [Cuentas nominativas y log consultable de quién hizo cada cosa](0016-cuentas-nominativas-y-firma-visible.md) | Aceptada |
| 0017 | [Redondeo del prorrateo por el método del mayor resto](0017-redondeo-por-mayor-resto.md) | Aceptada |
| 0018 | [El front pasa a React + shadcn/ui, compilado y servido por Django](0018-front-react-shadcn.md) | Aceptada |
