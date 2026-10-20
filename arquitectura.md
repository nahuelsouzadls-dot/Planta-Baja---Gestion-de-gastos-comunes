# Blueprint Arquitectónico: Sistema de Gestión de Propiedad Horizontal (MVP)

## 1. Contexto y Alcance (Scope)
- **Problema:** La administración actual (Confort S.A.) de un edificio antiguo de 12 apartamentos y 3 pisos (Montevideo, Uruguay) gestiona los gastos comunes mediante planillas Excel y distribución en papel. Esto genera errores de tipeo, cobros duplicados y pérdida de trazabilidad.
- **Objetivo (MVP):** Digitalizar la liquidación mensual, el cálculo de deudas mediante coeficientes de copropiedad y la validación de pagos, manteniendo una vía de escape analógica (PDFs unificados) para residentes mayores.
- **Modelo de Negocio:** SaaS B2B. Costo de infraestructura mínimo absorbido por el desarrollador, cobrando una suscripción fija mensual baja a la administración.

## 2. Usuarios y Roles
1. **Administración (Confort S.A.):** Ingresa gastos totales mensuales (O.S.E, U.T.E, Limpieza, Honorarios, Cuotas Extra). Valida manualmente los comprobantes de transferencia (Scotiabank). Genera reportes de morosos y PDFs impresos.
2. **Residente - Inquilino:** Asume los gastos comunes ordinarios. Tiene su propia cuenta corriente.
3. **Residente - Propietario:** Asume el Fondo de Reserva y Cuotas Extraordinarias. Si el apartamento no está alquilado, el propietario asume todos los gastos en una deuda unificada.

## 3. Stack Tecnológico (Monolito Robusto)
- **Backend & Admin Panel:** Python + Django (aprovechando el panel de administración nativo para la gestión de la administradora).
- **Base de Datos:** PostgreSQL.
- **Almacenamiento Estático (Comprobantes/PDFs):** Object Storage (Cloudflare R2 o Supabase Storage).
- **Manejo de Tareas Asíncronas:** Celery + Redis (para generación de PDFs y envío de correos masivos sin bloquear el _Event Loop_).
- **Infraestructura:** Render (PaaS) o VPS básico (DigitalOcean) con contenedores Docker.
- **Correos Transaccionales:** Resend o Brevo.

## 4. Diseño de Base de Datos y Modelo de Entidades (DER)
El sistema utiliza un enfoque de **Libro Mayor (Ledger) inmutable** para garantizar la integridad ACID en las finanzas.

- **Apartamento:** `numero`, `piso`, `coeficiente_copropiedad` (Decimal), `recibe_papel` (Boolean), `esta_alquilado` (Boolean). (Admite campo `JSONB` en Postgres para metadatos flexibles).
- **Residente:** Vinculado a `User` (Django Auth) y `Apartamento`. Campos: `rol` (Inquilino/Propietario).
- **GastoMensual (Liquidación):** `mes_cobro`, `total_ordinario`, `total_extraordinario`, `fondo_reserva_total`, `comprobantes_pdf`.
- **Movimiento (Ledger):** `residente` (FK con PROTECT), `fecha`, `tipo` (Cargo/Pago/Ajuste), `monto` (Decimal: negativo para deuda, positivo para pago), `estado_pago` (Completado/Pendiente/Rechazado), `comprobante_banco` (URL).

## 5. Lógica de Negocio y Flujos Críticos
- **Prorrateo Matemático:** Al "Generar Mes", el backend itera sobre los apartamentos. Multiplica los gastos ordinarios globales por el `coeficiente_copropiedad` de cada unidad y le asigna el cargo negativo (deuda) al residente correspondiente.
- **Validación Manual de Pagos:** El residente informa la transferencia y sube foto del comprobante. Se crea un `Movimiento` positivo en estado `Pendiente`. La administración revisa su cuenta bancaria, verifica la foto y cambia el estado a `Completado`, actualizando el saldo total.
- **Migración "Día Cero":** No se migrará el histórico en Excel. Se creará un Asiento de Apertura con los saldos iniciales consolidados (Caja y Reserva) en una fecha de corte.
- **Contingencia Analógica:** Botón de "Exportar Contabilidad a Excel" y envío automático mensual de la base de datos por email para seguridad psicológica del cliente.

---

# INSTRUCCIONES PARA EL AUDITOR TÉCNICO (CLAUDE / AI CLI)

Actúa como un **Arquitecto de Software Staff / Senior Reviewer**. Acabas de recibir este documento de diseño (PRD / Architecture Blueprint) para un proyecto SaaS inmobiliario. 

Tu tarea no es escribir el código, sino **auditar agresivamente este plan**. Quiero que indagues, tomes conjeturas y analices la solidez de lo que se ha pensado. 

Por favor, estructura tu respuesta en las siguientes secciones:

### 1. Puntos Fuertes (Lo que está bien planteado)
Identifica qué decisiones de arquitectura, stack y lógica de negocio (ej. el Ledger inmutable, el modelo de roles o el approach del MVP) consideras acertadas y listas para producción.

### 2. Análisis de Vulnerabilidades (Qué podría fallar)
Busca cuellos de botella, problemas de concurrencia, _edge cases_ (casos extremos) en el prorrateo contable, posibles vulnerabilidades de seguridad, o fallos lógicos en la experiencia de usuario (ej. qué pasa si un inquilino se muda a mitad de mes, o si hay un decimal redondeado mal en el prorrateo).

### 3. Escalabilidad y Deuda Técnica
Evalúa si este stack monolítico en Django con PostgreSQL será fácil de mantener o migrar en el futuro si el cliente escala de 1 edificio a 50 edificios. ¿Qué deuda técnica estamos asumiendo conscientemente hoy?

### 4. Recomendaciones del Arquitecto
Propón mejoras tangibles al modelo de base de datos, a la infraestructura o al flujo operativo. Recomienda patrones de diseño específicos para manejar los "Movimientos" contables sin que los saldos se corrompan.