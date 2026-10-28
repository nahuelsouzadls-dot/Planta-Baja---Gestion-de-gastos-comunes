/* Forma de las respuestas de /api/v1/. Los montos son siempre texto (ADR-0011). */

export type Money = string
export type Role = 'owner' | 'tenant'
export type AccountStatus = 'pagado' | 'revision' | 'pendiente' | 'moroso' | 'sin-cargar'
export type ReceiptStatus = 'pending' | 'approved' | 'rejected'
export type ClaimStatus = 'pending' | 'in_progress' | 'resolved'
export type ClaimKind = 'report' | 'complaint'

// ── Sesión ──────────────────────────────────────────────────────────────
export interface MeOccupancy {
  id: string
  unit_number: string
  building_name: string
  role: Role
  start_date: string
  end_date: string | null
}
export interface Me {
  id: string
  email: string
  first_name: string
  last_name: string
  organizations: { id: string; name: string }[]
  persons: { id: string; organization_id: string; occupancies: MeOccupancy[] }[]
}

// ── Panel ───────────────────────────────────────────────────────────────
export interface Organization {
  id: string
  name: string
}

export type StatusCounts = Record<AccountStatus, number>

export interface PortfolioBuilding {
  id: string
  name: string
  address: string
  neighborhood: string
  due_day: number
  units: number
  counts: StatusCounts
  expected: Money
  collected: Money
  in_review: Money
  debt: Money
  settlement: 'issued' | 'draft' | 'missing' | string
  severe: boolean
}

export interface QueueReceipt {
  id: string
  person: string
  building: string
  unit: string
  role: Role
  file: string
  date: string
  amount: Money
}

export interface Portfolio {
  month: string
  portfolio_totals: {
    accounts: number
    expected: Money
    collected: Money
    in_review: Money
    debt: Money
    delinquent: number
    open_claims: number
  }
  buildings: PortfolioBuilding[]
  receipt_queue: QueueReceipt[]
}

export interface Task {
  id: string
  building_id: string
  text: string
  done: boolean
  due_date: string | null
}

export interface HistoryMonth {
  month: string
  charged: Money
  collected: Money
}

export interface Unit {
  id: string
  number: string
  floor: number
  coefficient: string
}

export interface BuildingDetail {
  id: string
  name: string
  address: string
  units: Unit[]
}

export interface Person {
  name: string
  phone: string
  email: string
}

export interface Account {
  id: string
  unit: string
  coefficient: string
  person: Person
  role: Role
  receives_paper: boolean
  charge: Money
  /** Parte del cargo del mes ya cubierta (los pagos se imputan primero a lo más viejo). */
  paid: Money
  balance: Money
  status: AccountStatus
  overdue_months: string[]
  overdue_amount: Money
}

export interface Summary {
  month: string
  items: { concept: string; type: 'ordinary' | 'owner_only'; amount: Money; detail: string }[]
  funds: { reserve: Money; collected: Money; receivable: Money; coefficient_sum: string }
  delinquent: { unit: string; person: string; role: Role; months: string[]; debt: Money }[]
}

export interface Concept {
  id: string
  name: string
  kind: 'ordinary' | 'owner_only'
  is_reserve_fund: boolean
}

export interface Settlement {
  month: string
  status: 'issued' | 'draft'
  items: { concept: string; concept_id: string; amount: Money; detail: string }[]
  total: Money
  issued_by: string | null
  issued_at: string | null
}

export interface Notice {
  id: string
  title: string
  body: string
  date: string
}

export interface ClaimSummary {
  id: string
  title: string
  kind: ClaimKind
  unit: string
  author: string
  status: ClaimStatus
  date: string
  message_count: number
}

export interface ClaimThread extends Omit<ClaimSummary, 'message_count'> {
  messages: { id: string; author: string; from_admin: boolean; text: string; date: string }[]
}

export interface Movement {
  id: string
  kind: 'charge' | 'payment' | 'opening' | 'surcharge' | 'adjustment' | string
  date: string
  concept: string
  debit: Money
  credit: Money
  balance: Money
}

export interface PendingReceipt {
  id: string
  file: string
  date: string
  amount: Money
}

export interface Occupancy {
  id: string
  unit: string
  unit_id: string
  floor: number
  building: string
  coefficient: string
  role: Role
  status: AccountStatus
  person: Person
  other_occupancies: { id: string; role: Role; person: string }[]
  balance: Money
  overdue_months: string[]
  pending_receipt: PendingReceipt | null
  lines: {
    concept: string
    total: Money
    coefficient: string
    days: number | null
    days_in_month: number | null
    amount: Money
  }[]
  movements: Movement[]
}

export interface Receipt {
  id: string
  person: string
  building: string
  unit: string
  role: Role
  file: string
  content_type: string
  transfer_date: string
  declared_amount: Money
  note: string
  allocations: { occupancy: string; unit: string; building: string; role: Role; amount: Money }[]
  status: ReceiptStatus
  reason: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface SignedFile {
  url: string
  content_type: string
}

// ── Portal ──────────────────────────────────────────────────────────────
export interface PortalAccount {
  id: string
  name: string
  first_name: string
  building: string
  organization: string
  unit: string
  role: Role
  role_note: string
  status: AccountStatus
  balance: Money
  charge: Money
  overdue_months: string[]
  unpaid_months: string[]
  due_day: number
  pending_receipt: PendingReceipt | null
  concept: string
  bank: { bank_name: string; account: string; holder: string; concept: string }
  closed: boolean
}

export interface PortalMonth {
  month: string
  status: 'ok' | 'warn' | 'bad'
  charged: Money
  outstanding: Money
}

export interface PortalSettlement {
  month: string
  role: Role
  coefficient: string
  lines: {
    concept: string
    total: Money
    building_total: Money
    amount: Money
    detail: string
    coefficient: string
    days: number | null
    days_in_month: number | null
  }[]
  total: Money
}

export interface PortalReceipt {
  id: string
  month: string
  amount: Money
  declared_amount: Money
  date: string
  transfer_date: string
  file: string
  content_type: string
  note: string
  status: ReceiptStatus
  reason: string
}

export interface UploadIntent {
  url: string
  fields: Record<string, string>
  file_key: string
}
