import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type {
  Account, BuildingDetail, ClaimStatus, ClaimSummary, ClaimThread, Concept, HistoryMonth, Notice,
  Occupancy, Organization, Portfolio, Receipt, Settlement, SignedFile, Summary, Task,
} from '@/lib/types'

// ── Contexto del panel: administración elegida y búsqueda ──────────────
export interface PanelCtx {
  orgId: string
  orgs: Organization[]
  setOrgId: (id: string) => void
  query: string
  setQuery: (q: string) => void
  today: string
}
export const PanelContext = React.createContext<PanelCtx | null>(null)
export function usePanel() {
  const ctx = React.useContext(PanelContext)
  if (!ctx) throw new Error('usePanel fuera del panel')
  return ctx
}

// ── Lecturas ───────────────────────────────────────────────────────────
export function useOrganizations() {
  return useQuery({ queryKey: ['orgs'], queryFn: () => api.get<Organization[]>('organizations'), staleTime: 5 * 60_000 })
}

export function usePortfolio(orgId: string) {
  return useQuery({ queryKey: ['panel', 'portfolio', orgId], queryFn: () => api.get<Portfolio>(`organizations/${orgId}/portfolio`) })
}

export function useTasks(orgId: string) {
  return useQuery({
    queryKey: ['panel', 'tasks', orgId],
    queryFn: async () => (await api.get<{ tasks: Task[] }>(`organizations/${orgId}/tasks`)).tasks,
  })
}

export function useHistory(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['panel', 'history', orgId],
    queryFn: async () => (await api.get<{ months: HistoryMonth[] }>(`organizations/${orgId}/collection-history`)).months,
    enabled,
  })
}

export interface BuildingData {
  units: BuildingDetail['units']
  accounts: Account[]
  summary: Summary
  settlements: Settlement[]
  concepts: Concept[]
  notices: Notice[]
  claims: ClaimSummary[]
}

export function useBuilding(id: string | undefined) {
  return useQuery({
    queryKey: ['panel', 'building', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<BuildingData> => {
      const base = `buildings/${id}`
      const [detail, accounts, summary, settlements, notices, claims] = await Promise.all([
        api.get<BuildingDetail>(base),
        api.get<{ accounts: Account[] }>(base + '/accounts'),
        api.get<Summary>(base + '/summary'),
        api.get<{ settlements: Settlement[]; concepts: Concept[] }>(base + '/settlements'),
        api.get<{ notices: Notice[] }>(base + '/notices'),
        api.get<{ claims: ClaimSummary[] }>(base + '/claims'),
      ])
      return {
        units: detail.units,
        accounts: accounts.accounts,
        summary,
        settlements: settlements.settlements,
        concepts: settlements.concepts,
        notices: notices.notices,
        claims: claims.claims,
      }
    },
  })
}

export function useOccupancy(id: string | null) {
  return useQuery({ queryKey: ['panel', 'occupancy', id], queryFn: () => api.get<Occupancy>(`occupancies/${id}`), enabled: Boolean(id) })
}

export function useReceipt(id: string | null) {
  return useQuery({ queryKey: ['panel', 'receipt', id], queryFn: () => api.get<Receipt>(`receipts/${id}`), enabled: Boolean(id) })
}

export function useReceiptFile(id: string | null) {
  return useQuery({
    queryKey: ['receipt-file', id],
    queryFn: () => api.get<SignedFile>(`receipts/${id}/file`, { noRedirect: true }).catch(() => null),
    enabled: Boolean(id),
    staleTime: 4 * 60_000, // la URL firmada vence a los 5 minutos
  })
}

export function useClaim(id: string | null) {
  return useQuery({ queryKey: ['panel', 'claim', id], queryFn: () => api.get<ClaimThread>(`claims/${id}`), enabled: Boolean(id) })
}

// ── Escrituras ─────────────────────────────────────────────────────────
/** Después de escribir se vuelve a pedir todo lo del panel (los montos los calcula el backend). */
function useWrite<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['panel'] }) })
}

export const useApproveReceipt = () => useWrite((id: string) => api.post(`receipts/${id}/approve`))
export const useRejectReceipt = () => useWrite(({ id, reason }: { id: string; reason: string }) => api.post(`receipts/${id}/reject`, { reason }))

export const useSaveSettlement = (buildingId: string) =>
  useWrite(({ month, items }: { month: string; items: Record<string, { amount: string; detail?: string }> }) =>
    api.put(`buildings/${buildingId}/settlements/${month}`, { items }),
  )
export const useIssueSettlement = (buildingId: string) => useWrite((month: string) => api.post(`buildings/${buildingId}/settlements/${month}/issue`))

export const usePublishNotice = (buildingId: string) => useWrite((body: { title: string; body: string }) => api.post(`buildings/${buildingId}/notices`, body))
export const useReplyClaim = () => useWrite(({ id, text }: { id: string; text: string }) => api.post(`claims/${id}/replies`, { text }))
export const useClaimStatus = () => useWrite(({ id, status }: { id: string; status: ClaimStatus }) => api.patch(`claims/${id}`, { status }))

export const useAddTask = (orgId: string) => useWrite((body: { building_id: string; text: string }) => api.post<Task>(`organizations/${orgId}/tasks`, body))
export const useToggleTask = () => useWrite((id: string) => api.post<Task>(`tasks/${id}/toggle`))

export const useManualPayment = (occId: string) =>
  useWrite((body: { amount: string; date: string; source: string }) => api.post(`occupancies/${occId}/payments`, body))
export const useAdjustment = (occId: string) =>
  useWrite((body: { entry_id: string; amount: string; description: string }) => api.post(`occupancies/${occId}/adjustments`, body))
export const useMoveOut = () => useWrite(({ occId, end_date }: { occId: string; end_date: string }) => api.post(`occupancies/${occId}/move-out`, { end_date }))

export interface BuildingInput {
  name: string
  address: string
  neighborhood: string
  due_day: number
  bank_name: string
  bank_account: string
  bank_holder: string
}
export const useNewBuilding = (orgId: string) =>
  useWrite((body: BuildingInput) => api.post<{ id: string; name: string }>(`organizations/${orgId}/buildings`, body))

/** Alta de unidad con su propietario y, si viene, la deuda inicial (asiento de apertura del día cero). */
export const useNewUnit = (orgId: string) =>
  useWrite(async ({ buildingId, unit, owner, start, opening }: {
    buildingId: string
    unit: { number: string; floor: number; coefficient: string; receives_paper: boolean }
    owner: PersonInput
    start: string
    opening: string | null
  }) => {
    const created = await api.post<{ id: string }>(`buildings/${buildingId}/units`, unit)
    const person = await api.post<{ id: string }>(`organizations/${orgId}/people`, owner)
    const occ = await api.post<{ id: string }>(`units/${created.id}/move-in`, { person_id: person.id, role: 'owner', start_date: start })
    if (opening) await api.post(`occupancies/${occ.id}/opening`, { amount: opening, date: start })
  })

export interface PersonInput {
  first_name: string
  last_name: string
  email: string
  phone: string
}
export const useNewTenant = (orgId: string) =>
  useWrite(async ({ unitId, person, start, replace }: { unitId: string; person: PersonInput; start: string; replace: boolean }) => {
    const created = await api.post<{ id: string }>(`organizations/${orgId}/people`, person)
    if (replace) await api.post(`units/${unitId}/replace-tenant`, { person_id: created.id, change_date: start })
    else await api.post(`units/${unitId}/move-in`, { person_id: created.id, role: 'tenant', start_date: start })
  })
export const useSale = (orgId: string) =>
  useWrite(async ({ unitId, person, date }: { unitId: string; person: PersonInput; date: string }) => {
    const created = await api.post<{ id: string }>(`organizations/${orgId}/people`, person)
    await api.post(`units/${unitId}/sell`, { buyer_id: created.id, sale_date: date })
  })
