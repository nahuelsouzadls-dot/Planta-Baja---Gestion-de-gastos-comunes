import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type {
  ClaimKind, ClaimSummary, ClaimThread, Me, Movement, Notice, PortalAccount, PortalMonth,
  PortalReceipt, PortalSettlement, SignedFile, UploadIntent,
} from '@/lib/types'

export interface PortalOccupancy {
  id: string
  person_id: string
  unit_number: string
  building_name: string
  role: 'owner' | 'tenant'
  end_date: string | null
}

/** Primero las ocupaciones vigentes; las cerradas con saldo (ex inquilino, N17) al final. */
export function occupanciesOf(me: Me): PortalOccupancy[] {
  return me.persons
    .flatMap((p) => p.occupancies.map((o) => ({ ...o, person_id: p.id })))
    .sort((x, y) => Number(Boolean(x.end_date)) - Number(Boolean(y.end_date)))
}

const occ = (id: string, path: string) => `portal/occupancies/${id}/${path}`
const key = (id: string, ...rest: unknown[]) => ['portal', id, ...rest]

export function useAccount(id: string) {
  return useQuery({ queryKey: key(id, 'account'), queryFn: () => api.get<PortalAccount>(occ(id, 'account')) })
}

export function useMonths(id: string) {
  return useQuery({
    queryKey: key(id, 'months'),
    queryFn: async () => (await api.get<{ months: PortalMonth[] }>(occ(id, 'months'))).months,
  })
}

export function useSettlement(id: string, month: string | undefined) {
  return useQuery({
    queryKey: key(id, 'settlement', month),
    queryFn: () => api.get<PortalSettlement>(occ(id, `settlements/${month}`)),
    enabled: Boolean(month),
  })
}

export function useMovements(id: string, enabled: boolean) {
  return useQuery({
    queryKey: key(id, 'movements'),
    queryFn: async () => (await api.get<{ movements: Movement[] }>(occ(id, 'movements'))).movements,
    enabled,
  })
}

export function useReceipts(id: string) {
  return useQuery({
    queryKey: key(id, 'receipts'),
    queryFn: async () => (await api.get<{ receipts: PortalReceipt[] }>(occ(id, 'receipts'))).receipts,
  })
}

export function useReceiptFile(receiptId: string | null) {
  return useQuery({
    queryKey: ['portal-receipt-file', receiptId],
    queryFn: () => api.get<SignedFile>(`portal/receipts/${receiptId}/file`, { noRedirect: true }).catch(() => null),
    enabled: Boolean(receiptId),
    staleTime: 4 * 60_000, // la URL firmada vence a los 5 minutos
  })
}

export function useNotices(id: string) {
  return useQuery({
    queryKey: key(id, 'notices'),
    queryFn: async () => (await api.get<{ notices: Notice[] }>(occ(id, 'notices'))).notices,
  })
}

export function useClaims(id: string) {
  return useQuery({
    queryKey: key(id, 'claims'),
    queryFn: async () => (await api.get<{ claims: ClaimSummary[] }>(occ(id, 'claims'))).claims,
  })
}

export function useThread(claimId: string | null) {
  return useQuery({
    queryKey: ['portal-thread', claimId],
    queryFn: () => api.get<ClaimThread>(`portal/claims/${claimId}`),
    enabled: Boolean(claimId),
  })
}

export function useCreateClaim(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: ClaimKind; title: string; body: string }) => api.post<ClaimThread>(occ(id, 'claims'), body),
    onSuccess: (claim) => {
      qc.setQueryData(['portal-thread', claim.id], claim)
      qc.invalidateQueries({ queryKey: key(id, 'claims') })
    },
  })
}

export function useReply(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, text }: { claimId: string; text: string }) => api.post(`portal/claims/${claimId}/replies`, { text }),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['portal-thread', claimId] })
      qc.invalidateQueries({ queryKey: key(id, 'claims') })
    },
  })
}

// ── Subir comprobante ──────────────────────────────────────────────────
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']

/** Tipo MIME a declarar: el del navegador o, si no lo trae (HEIC en algunos), por extensión. */
export function mimeOf(file: File): string {
  if (RECEIPT_TYPES.includes(file.type)) return file.type
  const ext = (file.name.match(/\.(\w+)$/) || [])[1] || ''
  const byExt: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp', pdf: 'application/pdf' }
  return byExt[ext.toLowerCase()] || file.type
}

/** Devuelve un mensaje si el archivo no sirve. */
export function checkReceiptFile(file: File): string | null {
  if (!RECEIPT_TYPES.includes(file.type) && !/\.(jpe?g|png|heic|webp|pdf)$/i.test(file.name)) return 'Ese archivo no es una foto ni un PDF. Probá de nuevo.'
  if (file.size > MAX_RECEIPT_BYTES) return 'El archivo pesa más de 10 MB. Probá con una foto más chica.'
  if (!file.size) return 'El archivo está vacío. Probá de nuevo.'
  return null
}

export interface ReceiptSubmit {
  file: File
  amount: string
  date: string
  allocations?: { occupancy_id: string; amount: string }[]
  note?: string
}

/** Sube el archivo directo al almacenamiento (URL firmada, ADR de D1) y registra el comprobante. */
export function useSubmitReceipt(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, amount, date, allocations, note }: ReceiptSubmit) => {
      const intent = await api.post<UploadIntent>(occ(id, 'receipts/upload'), {
        content_type: mimeOf(file),
        size_bytes: file.size,
        filename: file.name.slice(0, 120),
      })
      const body = new FormData()
      Object.entries(intent.fields).forEach(([k, v]) => body.append(k, v))
      body.append('file', file)
      let sent: Response
      try {
        sent = await fetch(intent.url, { method: 'POST', body })
      } catch {
        throw new Error('No se pudo subir el archivo. Revisá tu conexión y probá de nuevo.')
      }
      if (!sent.ok) throw new Error('El almacenamiento rechazó el archivo. Probá de nuevo.')
      await api.post('portal/receipts', {
        file_key: intent.file_key,
        declared_amount: amount,
        transfer_date: date,
        ...(allocations ? { allocations, note: note ?? '' } : {}),
      })
    },
    // Un pago repartido toca la cuenta de varias unidades.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  })
}
