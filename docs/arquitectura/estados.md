# UML — Diagramas de estados

## Liquidación (`Settlement`)

```mermaid
stateDiagram-v2
    [*] --> draft: save_draft
    draft --> draft: editar ítems
    draft --> issued: issue (crea los cargos)
    issued --> [*]
    note right of issued
        Inmutable. Un error se corrige
        con asientos de ajuste, no
        reabriendo la liquidación.
    end note
```

## Comprobante (`Receipt`)

```mermaid
stateDiagram-v2
    [*] --> pending: el residente lo sube
    pending --> approved: la administración verifica en el banco<br/>(crea los pagos en el libro mayor)
    pending --> rejected: no coincide (motivo obligatorio)
    approved --> [*]
    rejected --> [*]
    note right of rejected
        El archivo se conserva como
        evidencia. El residente puede
        subir uno nuevo.
    end note
```

## Ocupación (`Occupancy`)

```mermaid
stateDiagram-v2
    [*] --> vigente: move_in / sell (comprador)
    vigente --> cerrada: move_out (inquilino)
    vigente --> cerrada: sell (vendedor, solo con saldo 0)
    cerrada --> [*]
    note right of cerrada
        Conserva su cuenta corriente.
        Un inquilino que se fue con
        deuda sigue apareciendo
        como moroso.
    end note
```

## Estado de cuenta de una ocupación (calculado, no guardado)

```mermaid
stateDiagram-v2
    direction LR
    state "¿comprobante pending?" as q1
    state "¿meses anteriores sin cubrir?" as q2
    state "¿saldo > 0?" as q3
    [*] --> q1
    q1 --> revision: sí
    q1 --> q2: no
    q2 --> moroso: sí
    q2 --> q3: no
    q3 --> pendiente: sí
    q3 --> pagado: no
```

Es el mismo criterio que usa el front (`design/assets/ledger.js`), con la imputación FIFO de pagos parciales del modelo nuevo.

## Reclamo (`Claim`)

```mermaid
stateDiagram-v2
    [*] --> pending: el residente lo abre
    pending --> in_progress: la administración responde o lo toma
    in_progress --> resolved
    pending --> resolved
    resolved --> in_progress: se reabre
```

## Invitación (`Invitation`)

```mermaid
stateDiagram-v2
    [*] --> enviada
    enviada --> usada: accept con token válido
    enviada --> vencida: pasaron 72 h
    enviada --> reemplazada: se reenvía (la anterior queda inválida)
    usada --> [*]
    vencida --> [*]
    reemplazada --> [*]
```
