import * as React from 'react'
import { useSearchParams } from 'react-router'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import type { Account, AccountStatus, StatusCounts } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Tarjeta de cifra del mes. */
const FIG_TONE = {
  ok: ['text-ok', 'bg-ok'],
  warn: ['text-warn', 'bg-brand-amber'],
  bad: ['text-bad', 'bg-bad'],
  brand: ['text-brand', 'bg-brand'],
} as const

/** Cifra del tablero. El tono pinta el número y el punto de la etiqueta: verde cobrado, ámbar acción, rojo mora. */
export function Fig({ label, value, foot, tone, bar }: { icon?: React.ReactNode; label: string; value: React.ReactNode; foot: React.ReactNode; tone?: keyof typeof FIG_TONE; bar?: number }) {
  // Un cero no pide atención: queda en gris aunque la cifra tenga tono.
  const zero = typeof value === 'string' && /^[^1-9]*$/.test(value)
  const [text, dot] = tone && !zero ? FIG_TONE[tone] : ['', 'bg-muted-foreground/40']
  return (
    <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('num mt-2 truncate font-display text-[20px] leading-tight font-bold tracking-tight sm:text-[28px]', text)}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{foot}</div>
      {bar != null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out-soft', tone === 'ok' ? 'bg-ok' : 'bg-acc')} style={{ width: `${Math.min(bar, 100)}%` }} />
        </div>
      ) : null}
    </div>
  )
}

/** Color del % cobrado: verde desde 90, marca desde 60, ámbar por debajo. */
export const pctTone = (p: number) => (p >= 90 ? 'text-ok' : p >= 60 ? 'text-brand' : 'text-warn')
export const pctBar = (p: number) => (p >= 90 ? 'bg-ok' : p >= 60 ? 'bg-acc' : 'bg-brand-amber')

export function Figs({ children }: { children: React.ReactNode }) {
  return (
    <Card className="grid grid-cols-2 gap-y-2 py-2 xl:grid-cols-4">{children}</Card>
  )
}

export function FigsSkeleton() {
  return (
    <Card className="grid grid-cols-2 gap-6 p-6 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </Card>
  )
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-4 p-5" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="grid flex-1 gap-1.5"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-1/5" /></div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}

export function SectionTitle({ children, hint, action }: { children: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
      <div>
        <h2 className="text-[15px] font-bold">{children}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function matchesQuery(text: string, query: string) {
  const q = query.trim().toLowerCase()
  return !q || text.toLowerCase().includes(q)
}

/** Cuentas ordenadas por unidad y con el propietario primero. */
export function sortedAccounts(accounts: Account[]) {
  return accounts.slice().sort((x, y) => x.unit.localeCompare(y.unit, 'es', { numeric: true }) || (x.role === 'owner' ? -1 : 1))
}

export const hasTenant = (accounts: Account[], unit: string) => accounts.some((a) => a.unit === unit && a.role === 'tenant')

const LEGEND: Record<AccountStatus, [string, string]> = {
  pagado: ['al día', 'al día'],
  revision: ['en revisión', 'en revisión'],
  pendiente: ['pendiente', 'pendientes'],
  moroso: ['moroso', 'morosos'],
  'sin-cargar': ['sin liquidación', 'sin liquidación'],
}
export const legend = (counts: StatusCounts) =>
  (Object.keys(LEGEND) as AccountStatus[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${LEGEND[k][counts[k] === 1 ? 0 : 1]}`)
    .join(' · ')

export const shortName = (name: string) => name.replace('Edificio ', '')

/** Paneles superpuestos (ficha de unidad, comprobante, gastos) en la URL: el botón Atrás los cierra. */
export function useOverlay(name: 'unidad' | 'comprobante' | 'gastos' | 'alta') {
  const [params, setParams] = useSearchParams()
  const value = params.get(name)
  const open = React.useCallback(
    (v: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.set(name, v)
        return next
      }),
    [name, setParams],
  )
  const close = React.useCallback(
    () =>
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.delete(name)
        return next
      }),
    [name, setParams],
  )
  return { value, open, close }
}
