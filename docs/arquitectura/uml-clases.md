# UML — Diagrama de clases

Refleja `docs/modelo-datos.md` (aprobado 2026-10-23). Los nombres son los del código (en inglés). Todas las clases tienen `id` UUID como clave primaria; `?` = opcional.

## 1. Bases e identidad (`core`, `accounts`)

```mermaid
classDiagram
    direction LR
    class UUIDModel {
        <<abstract>>
        +UUID id
    }
    class TimeStampedModel {
        <<abstract>>
        +datetime created_at
        +datetime updated_at
    }
    class User {
        +str email (único, minúsculas)
        +str first_name
        +str last_name
        +bool is_active
        +bool is_staff
        +datetime date_joined
        +str password (Argon2)
    }
    class Organization {
        +str name
        +str tax_id?
        +str email?
    }
    class OrgMembership {
        +User user
        +Organization organization
    }
    class Invitation {
        +Person person
        +str email
        +str token_hash (sha256)
        +datetime expires_at
        +datetime used_at?
        +User created_by
        +is_valid() bool
    }

    UUIDModel <|-- TimeStampedModel
    UUIDModel <|-- User
    TimeStampedModel <|-- Organization
    TimeStampedModel <|-- OrgMembership
    TimeStampedModel <|-- Invitation
    User "1" -- "0..*" OrgMembership
    Organization "1" -- "0..*" OrgMembership
    note for OrgMembership "Único (user, organization).\nSin roles: todos los miembros\ntienen los mismos permisos."
```

## 2. Edificios, personas y ocupaciones

```mermaid
classDiagram
    direction LR
    class Organization
    class Building {
        +Organization organization
        +str name
        +str address
        +str neighborhood
        +str city
        +str bank_name
        +str bank_account
        +str bank_holder
        +int due_day (1–28)
        +Decimal reserve_opening
        +date opening_date
        +bool is_active
    }
    class Unit {
        +Building building
        +str number
        +int floor
        +Decimal coefficient (7,6) > 0
        +bool receives_paper
    }
    class ExpenseConcept {
        +Building building
        +str name
        +Kind kind
        +bool is_reserve_fund
        +int order
        +bool is_active
    }
    class Kind {
        <<enumeration>>
        ordinary
        owner_only
    }
    class Person {
        +Organization organization
        +str first_name
        +str last_name
        +str document?
        +str phone?
        +str email?
        +User user?
        +bool has_account()
    }
    class Occupancy {
        +Unit unit
        +Person person
        +Role role
        +date start_date
        +date end_date?
        +is_current() bool
        +days_in(month) int
    }
    class Role {
        <<enumeration>>
        owner
        tenant
    }

    Organization "1" -- "0..*" Building
    Organization "1" -- "0..*" Person
    Building "1" -- "1..*" Unit
    Building "1" -- "1..*" ExpenseConcept
    Unit "1" -- "1..*" Occupancy
    Person "1" -- "0..*" Occupancy
    ExpenseConcept ..> Kind
    Occupancy ..> Role

    note for Unit "Único (building, number).\nΣ coefficient del edificio = 1\n(se valida en el servicio)."
    note for Occupancy "EXCLUDE: mismo unit + role sin\nfechas superpuestas (btree_gist).\nToda unidad tiene un owner vigente.\nCerrar un owner exige saldo 0."
    note for Person "Único (organization, email)\ncuando hay email.\nSin user = responsable sin cuenta."
```

## 3. Liquidaciones, libro mayor y pagos

```mermaid
classDiagram
    direction LR
    class Settlement {
        +Building building
        +date month (día 1)
        +Status status
        +datetime issued_at?
        +User issued_by?
        +total() Decimal
    }
    class SettlementStatus {
        <<enumeration>>
        draft
        issued
    }
    class SettlementItem {
        +Settlement settlement
        +ExpenseConcept concept
        +Decimal amount (12,2) ≥ 0
        +str detail?
    }
    class LedgerEntry {
        <<append-only>>
        +Occupancy occupancy
        +date date
        +Kind kind
        +Decimal amount (12,2) +debe / −haber
        +Settlement settlement?
        +ExpenseConcept concept?
        +Receipt receipt?
        +LedgerEntry adjusts?
        +str description
        +User created_by
        +Decimal base_amount?
        +Decimal coefficient?
        +int days?
        +int days_in_month?
    }
    class EntryKind {
        <<enumeration>>
        opening
        charge
        payment
        adjustment
        surcharge
    }
    class Receipt {
        <<evidencia>>
        +Person person
        +User uploaded_by
        +str file_key (UUID en R2)
        +str file_sha256
        +str content_type
        +int size_bytes
        +Decimal declared_amount
        +date transfer_date
        +str note (aclaración)
        +Status status
        +str rejection_reason?
        +User reviewed_by?
        +datetime reviewed_at?
    }
    class ReceiptStatus {
        <<enumeration>>
        pending
        approved
        rejected
    }
    class ReceiptAllocation {
        +Receipt receipt
        +Occupancy occupancy
        +Decimal amount
    }

    Settlement "1" *-- "1..*" SettlementItem
    Settlement ..> SettlementStatus
    SettlementItem "*" --> "1" ExpenseConcept
    Settlement "0..1" -- "0..*" LedgerEntry : origina cargos
    Occupancy "1" -- "0..*" LedgerEntry : cuenta corriente
    LedgerEntry ..> EntryKind
    LedgerEntry "0..1" --> "0..1" LedgerEntry : adjusts
    Receipt "1" *-- "1..*" ReceiptAllocation
    ReceiptAllocation "*" --> "1" Occupancy
    Receipt "0..1" -- "0..*" LedgerEntry : respalda pagos
    Receipt ..> ReceiptStatus

    note for LedgerEntry "Trigger de Postgres: rechaza\nUPDATE y DELETE.\nSaldo = SUM(amount).\nUn pago = kind payment con\ncreated_by (verificación humana)."
    note for ReceiptAllocation "Σ amount = declared_amount.\nTodas las ocupaciones\nson de la misma persona."
```

## 4. Comunicación, tareas y auditoría

```mermaid
classDiagram
    direction LR
    class Notice {
        +Building building
        +str title
        +str body
        +User published_by
    }
    class Claim {
        +Building building
        +Unit unit
        +Person author
        +ClaimKind kind
        +str title
        +ClaimStatus status
    }
    class ClaimKind {
        <<enumeration>>
        report
        complaint
    }
    class ClaimStatus {
        <<enumeration>>
        pending
        in_progress
        resolved
    }
    class ClaimMessage {
        <<inmutable>>
        +Claim claim
        +User author
        +bool from_admin
        +str text
    }
    class Task {
        +Organization organization
        +Building building
        +str text
        +date due_date?
        +bool done
        +User created_by
    }
    class AuditLog {
        <<append-only>>
        +User actor
        +Organization organization
        +str action
        +str target_type
        +UUID target_id
        +json data (sin datos sensibles)
        +str ip
        +datetime created_at
    }

    Claim "1" *-- "1..*" ClaimMessage
    Claim ..> ClaimKind
    Claim ..> ClaimStatus
```

## 5. Servicios de dominio

Toda escritura de negocio pasa por un servicio: corre en `transaction.atomic()`, valida, escribe y audita.

```mermaid
classDiagram
    direction TB
    class BuildingService {
        +validate_coefficients(building)
        +create_default_concepts(building)
    }
    class OccupancyService {
        +move_in(unit, person, role, start_date) Occupancy
        +move_out(occupancy, end_date)
        +sell(unit, buyer, date)
        -assert_owner_coverage(unit)
    }
    class SettlementService {
        +save_draft(building, month, items) Settlement
        +issue(settlement, user)
        -prorate(item, unit, month) list~Share~
        -fix_rounding(shares, total)
    }
    class PaymentService {
        +submit_receipt(person, file, amount, allocations, note) Receipt
        +approve(receipt, user, allocations?)
        +reject(receipt, user, reason)
        +record_manual(occupancy, amount, date, user, source)
    }
    class AccountService {
        +balance(occupancy) Decimal
        +allocate_fifo(occupancy) list~MonthStatus~
        +status(occupancy) str
        +statement(occupancy) list~LedgerEntry~
    }
    class InvitationService {
        +invite(person, user) Invitation
        +accept(token, password) User
    }
    class AuditService {
        +record(actor, action, target, data)
    }

    OccupancyService ..> AccountService : venta exige saldo 0
    SettlementService ..> AuditService
    PaymentService ..> AuditService
    OccupancyService ..> AuditService
    InvitationService ..> AuditService
```

Las reglas de cada servicio están en [`modelo-datos.md` §5](../modelo-datos.md) y los flujos en [`secuencias.md`](secuencias.md).
