import * as React from 'react'
import { useSearchParams } from 'react-router'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import type { Account, AccountStatus, StatusCounts } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Tarjeta de cifra del mes. */
export function Fig({ icon, label, value, foot, tone, bar }: { icon: React.ReactNode; label: string; value: React.ReactNode; foot: React.ReactNode; tone?: 'bad' | 'warn'; bar?: number }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase sm:text-[11px]">
        <span className="grid size-6 place-items-center rounded-md bg-acc-soft text-[color-mix(in_srgb,var(--acc)_75%,#000)] [&_svg]:size-3.5" aria-hidden="true">{icon}</span>
        {label}
      </div>
      <div className={cn('num mt-2 truncate font-display text-[20px] leading-tight font-bold tracking-tight sm:text-[28px]', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{foot}</div>
      {bar != null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-acc transition-[width] duration-700 ease-out-soft" style={{ width: `${Math.min(bar, 100)}%` }} />
        </div>
      ) : null}
    </div>
  )
}

export function Figs({ children }: { children: React.ReactNode }) {
  return (
    <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line xl:grid-cols-4 [&>*]:bg-card">{children}</Card>
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
export function useOverlay(name: 'unidad' | 'comprobante' | 'gastos') {
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
