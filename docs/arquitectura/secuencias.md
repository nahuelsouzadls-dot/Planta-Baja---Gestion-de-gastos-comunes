# UML — Diagramas de secuencia

Los flujos críticos del sistema. Cada servicio corre en una transacción; si algo falla, no queda nada a medias.

## 1. Emitir la liquidación del mes

```mermaid
sequenceDiagram
    autonumber
    actor A as Administración
    participant V as API /settlements/{id}/issue
    participant S as SettlementService
    participant DB as PostgreSQL
    participant Q as Celery

    A->>V: POST (cookie de sesión + CSRF)
    V->>V: ¿el edificio es de su organización? (si no, 404)
    V->>S: issue(settlement, user)
    S->>DB: BEGIN · SELECT … FOR UPDATE (settlement)
    S->>S: status == draft · hay ítems · Σ coeficientes == 1
    loop cada unidad × cada ítem
        S->>DB: ocupaciones que se superponen con el mes
        S->>S: base = monto × coeficiente
        S->>S: owner_only → owners por días<br/>ordinary → tenants por días, resto al owner
        S->>S: parte = base × días / días_del_mes (ROUND_HALF_UP)
    end
    S->>S: diferencia de redondeo → la parte más grande
    S->>DB: INSERT LedgerEntry charge (con la foto del cálculo)
    S->>DB: UPDATE settlement SET status = issued
    S->>DB: INSERT AuditLog settlement.issue
    S->>DB: COMMIT
    S-->>Q: on_commit: generar PDF y enviar emails
    V-->>A: 200 · resumen de lo emitido
```

## 2. Pago con comprobante (residente → verificación de la administración)

```mermaid
sequenceDiagram
    autonumber
    actor R as Residente
    actor A as Administración
    participant API as API
    participant P as PaymentService
    participant R2 as Cloudflare R2
    participant DB as PostgreSQL

    R->>API: pedir URL de subida (tipo, tamaño)
    API->>API: tipo en lista blanca · ≤ 10 MB
    API-->>R: URL firmada PUT (5 min) + file_key UUID
    R->>R2: PUT archivo (no pasa por Django)
    R->>API: submit_receipt(file_key, monto, fecha, reparto por unidad, aclaración)
    API->>P: submit_receipt(...)
    P->>R2: HEAD + primeros bytes: verifica magic bytes, tamaño y sha256
    P->>P: Σ reparto == monto · todas las ocupaciones son del usuario
    P->>DB: INSERT Receipt pending + ReceiptAllocation · AuditLog
    API-->>R: "Recibimos tu comprobante" (estado: en revisión)

    A->>API: ver comprobante
    API-->>A: URL firmada GET (5 min)
    A->>A: compara con el extracto de Scotiabank
    alt el pago está en el banco
        A->>API: approve(receipt, reparto ajustado si hace falta)
        API->>P: approve(...)
        P->>DB: BEGIN · SELECT receipt FOR UPDATE · status == pending
        P->>DB: INSERT LedgerEntry payment (−monto) por cada reparto, created_by = admin
        P->>DB: UPDATE receipt SET approved · AuditLog receipt.approve · COMMIT
    else no aparece o no coincide
        A->>API: reject(receipt, motivo)
        P->>DB: UPDATE receipt SET rejected, motivo · AuditLog · COMMIT
        Note over P,DB: el libro mayor no se toca
    end
```

El `SELECT … FOR UPDATE` más el chequeo de `pending` hacen que aprobar dos veces (doble clic, dos admins a la vez) no duplique el pago.

## 3. Pago registrado sin comprobante

```mermaid
sequenceDiagram
    autonumber
    actor A as Administración
    participant P as PaymentService
    participant DB as PostgreSQL

    A->>A: ve la transferencia en el extracto
    A->>P: record_manual(ocupación, monto, fecha, "extracto 21/10, ref. 4821")
    P->>P: monto > 0 · la ocupación es de su organización · descripción obligatoria
    P->>DB: INSERT LedgerEntry payment (−monto, created_by = admin, receipt = null)
    P->>DB: INSERT AuditLog payment.record_manual
```

## 4. Mudanza de inquilino

```mermaid
sequenceDiagram
    autonumber
    actor A as Administración
    participant O as OccupancyService
    participant DB as PostgreSQL

    A->>O: move_out(ocupación de Ana, 14/03)
    O->>DB: UPDATE occupancy SET end_date = 14/03
    Note over O,DB: Ana conserva su saldo:<br/>le van a llegar los días 1–14 de marzo
    A->>O: move_in(unidad 102, Bruno, tenant, 15/03)
    O->>DB: INSERT occupancy (la restricción EXCLUDE rechaza superposiciones)
    O->>DB: AuditLog occupancy.move_out / move_in
    Note over O,DB: al emitir marzo: Ana paga 14/31 de los ordinarios,<br/>Bruno 17/31. El propietario sigue con owner_only
```

## 5. Venta de la unidad

```mermaid
sequenceDiagram
    autonumber
    actor A as Administración
    participant O as OccupancyService
    participant AC as AccountService
    participant DB as PostgreSQL

    A->>O: sell(unidad 301, comprador, fecha)
    O->>AC: balance(ocupación del vendedor)
    alt saldo > 0
        O-->>A: error: "El vendedor tiene que estar al día ($ X)"
    else saldo == 0
        O->>DB: BEGIN · cerrar ocupación del vendedor (end_date = fecha − 1)
        O->>DB: INSERT ocupación owner del comprador (start_date = fecha)
        O->>DB: AuditLog occupancy.sell · COMMIT
    end
```

## 6. Invitación y primer ingreso del residente

```mermaid
sequenceDiagram
    autonumber
    actor A as Administración
    actor R as Residente
    participant I as InvitationService
    participant DB as PostgreSQL
    participant M as Email (Celery)

    A->>I: invite(persona con email)
    I->>I: token = 32 bytes aleatorios (secrets)
    I->>DB: INSERT Invitation(token_hash = sha256(token), expira en 72 h)
    I-->>M: on_commit: email con link /aceptar?token=…
    R->>I: accept(token, contraseña)
    I->>DB: buscar por sha256(token) · no usada · no vencida
    I->>I: validar contraseña (largo ≥ 10, validadores de Django)
    I->>DB: crear User (email = persona.email) · persona.user = user · used_at = ahora
    I->>DB: AuditLog invitation.accept
    I-->>R: sesión iniciada → portal
```

El token en claro solo existe en el email; en la base queda su hash, así una filtración de la base no permite activar cuentas.

## 7. Login y protección contra fuerza bruta

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant L as Login (Django)
    participant AX as django-axes
    participant DB as PostgreSQL

    U->>L: POST email + contraseña + CSRF
    L->>AX: ¿email + IP bloqueados?
    alt bloqueado (≥ 5 fallos en 1 h)
        AX-->>U: 403 "Probá de nuevo más tarde"
    else
        L->>DB: buscar User por email (minúsculas) · verificar Argon2
        alt correcto
            L->>DB: crear sesión · rotar id de sesión
            L-->>U: cookie de sesión HttpOnly, Secure, SameSite=Lax
        else incorrecto
            AX->>DB: registrar intento fallido
            L-->>U: "Email o contraseña incorrectos" (mismo mensaje en todos los casos)
        end
    end
```
