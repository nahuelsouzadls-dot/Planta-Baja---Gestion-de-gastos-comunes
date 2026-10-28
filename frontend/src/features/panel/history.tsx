import * as React from 'react'
import { useQueries } from '@tanstack/react-query'
import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon, HistoryIcon, PanelRightOpenIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, NativeSelect } from '@/components/ui/form'
import { Chip, Skeleton } from '@/components/ui/misc'
import { Empty, ErrorState, ROLE_LABEL, StatusPill, useDocumentTitle } from '@/components/shared'
import { api, apiUrl, openSigned } from '@/lib/api'
import { dateShort, money, monthTitle } from '@/lib/format'
import type { Concept, Portfolio, Settlement } from '@/lib/types'
import { cn, pct } from '@/lib/utils'
import { pctBar, pctTone, RowsSkeleton, SectionTitle, sortedAccounts, useOverlay } from './bits'
import { useBuilding, useHistory, useOccupancy, usePanel } from './data'
import { owedText } from './receipt-dialog'

type View = 'cobranza' | 'liquidaciones' | 'unidad'
const VIEWS: [View, string][] = [['cobranza', 'Cobranza por mes'], ['liquidaciones', 'Liquidaciones'], ['unidad', 'Cuenta de una unidad']]

/** Consultar lo pasado: cobranza de cada mes, liquidaciones emitidas y la cuenta completa de una unidad. */
export function HistoryPage({ portfolio }: { portfolio: Portfolio }) {
  useDocumentTitle('Historial · Administración')
  const [view, setView] = React.useState<View>('cobranza')
  return (
    <div className="grid gap-6 pt-2">
      <header>
        <h1 className="text-[28px] leading-tight font-bold">Historial</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">Cobranza, liquidaciones y cuentas de meses anteriores.</p>
      </header>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Vista">
        {VIEWS.map(([v, label]) => <Chip key={v} active={view === v} onClick={() => setView(v)}>{label}</Chip>)}
      </div>
      {view === 'cobranza' ? <Collection /> : null}
      {view === 'liquidaciones' ? <Settlements portfolio={portfolio} /> : null}
      {view === 'unidad' ? <UnitAccount portfolio={portfolio} /> : null}
    </div>
  )
}

// ── Cobranza por mes (toda la cartera) ─────────────────────────────────
function Collection() {
  const { orgId } = usePanel()
  const q = useHistory(orgId, true)
  const rows = (q.data ?? []).slice().sort((x, y) => y.month.localeCompare(x.month))
  return (
    <Card>
      <SectionTitle hint="Lo emitido y lo cobrado en todos los edificios, por mes.">Cobranza por mes</SectionTitle>
      <div className="overflow-x-auto p-2 sm:p-3">
        {q.error ? (
          <div className="p-3"><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></div>
        ) : q.isPending ? (
          <RowsSkeleton rows={4} />
        ) : !rows.length ? (
          <Empty icon={<HistoryIcon />} title="Sin historial" className="m-2 border-none">Todavía no hay liquidaciones emitidas.</Empty>
        ) : (
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <th className="px-3 py-2 font-semibold">Mes</th>
                <th className="px-3 py-2 text-right font-semibold">Emitido</th>
                <th className="px-3 py-2 text-right font-semibold">Cobrado</th>
                <th className="w-[38%] px-3 py-2 font-semibold">Cobranza</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const p = pct(m.collected, m.charged)
                return (
                  <tr key={m.month} className="border-t border-line transition-colors first:border-0 hover:bg-brand-soft/60">
                    <td className="px-3 py-3 font-medium">{monthTitle(m.month)}</td>
                    <td className="num px-3 py-3 text-right">{money(m.charged)}</td>
                    <td className="num px-3 py-3 text-right font-semibold text-ok">{money(m.collected)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn('block h-full rounded-full', pctBar(p))} style={{ width: `${Math.min(p, 100)}%` }} /></span>
                        <span className={cn('num w-12 text-right font-bold', pctTone(p))}>{p} %</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}

// ── Liquidaciones emitidas de todos los edificios ──────────────────────
function Settlements({ portfolio }: { portfolio: Portfolio }) {
  const buildings = portfolio.buildings
  const qs = useQueries({
    queries: buildings.map((b) => ({
      queryKey: ['panel', 'settlements', b.id],
      queryFn: () => api.get<{ settlements: Settlement[]; concepts: Concept[] }>(`buildings/${b.id}/settlements`),
    })),
  })
  const [bid, setBid] = React.useState('all')
  const rows = qs
    .flatMap((q, i) => (q.data?.settlements ?? []).map((s) => ({ ...s, building: buildings[i] })))
    .filter((r) => r.status === 'issued' && (bid === 'all' || r.building.id === bid))
  const years = Array.from(new Set(rows.map((r) => r.month.slice(0, 4)))).sort().reverse()
  const [year, setYear] = React.useState<string | null>(null)
  const y = year && years.includes(year) ? year : years[0]
  const visible = rows.filter((r) => r.month.startsWith(y ?? '')).sort((a, b) => b.month.localeCompare(a.month) || a.building.name.localeCompare(b.building.name))
  const pending = qs.some((q) => q.isPending)

  return (
    <Card>
      <SectionTitle
        hint="Cada liquidación emitida queda fija: podés volver a bajar su PDF o su Excel."
        action={
          <div className="flex gap-2">
            <NativeSelect aria-label="Edificio" value={bid} onChange={(e) => setBid(e.target.value)} className="w-48">
              <option value="all">Todos los edificios</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
            {years.length ? (
              <NativeSelect aria-label="Año" value={y} onChange={(e) => setYear(e.target.value)} className="w-28">
                {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
              </NativeSelect>
            ) : null}
          </div>
        }
      >
        Liquidaciones
      </SectionTitle>
      <div className="overflow-x-auto p-2 sm:p-3">
        {pending ? (
          <RowsSkeleton rows={5} />
        ) : !visible.length ? (
          <Empty icon={<FileTextIcon />} title="Sin liquidaciones" className="m-2 border-none">No hay liquidaciones emitidas con ese filtro.</Empty>
        ) : (
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <th className="px-3 py-2 font-semibold">Mes</th>
                <th className="px-3 py-2 font-semibold">Edificio</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Emitida</th>
                <th className="px-3 py-2"><span className="sr-only">Descargas</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.building.id + s.month} className="border-t border-line transition-colors first:border-0 hover:bg-brand-soft/60">
                  <td className="px-3 py-3 font-medium whitespace-nowrap">{monthTitle(s.month)}</td>
                  <td className="px-3 py-3">{s.building.name}</td>
                  <td className="num px-3 py-3 text-right font-semibold">{money(s.total)}</td>
                  <td className="px-3 py-3 text-muted-foreground">{s.issued_at ? dateShort(s.issued_at) : '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => openSigned(api.get(`buildings/${s.building.id}/settlements/${s.month}/pdf`)).catch((e) => toast.error(e.message))}>
                      <FileTextIcon />PDF
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={apiUrl(`buildings/${s.building.id}/settlements/${s.month}/export`)} download><FileSpreadsheetIcon />Excel</a>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}

// ── Cuenta corriente de una unidad ─────────────────────────────────────
function UnitAccount({ portfolio }: { portfolio: Portfolio }) {
  const [bid, setBid] = React.useState(portfolio.buildings[0]?.id ?? '')
  const b = useBuilding(bid || undefined)
  const accounts = b.data ? sortedAccounts(b.data.accounts) : []
  const [occId, setOccId] = React.useState('')
  const current = accounts.find((a) => a.id === occId) ? occId : accounts[0]?.id ?? ''
  const o = useOccupancy(current || null)
  const unit = useOverlay('unidad')

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
      <Card className="grid gap-4 p-5">
        <Field label="Edificio" htmlFor="h-b">
          <NativeSelect id="h-b" value={bid} onChange={(e) => { setBid(e.target.value); setOccId('') }}>
            {portfolio.buildings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Unidad y responsable" htmlFor="h-o">
          {b.isPending ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <NativeSelect id="h-o" value={current} onChange={(e) => setOccId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.unit} · {a.person.name} ({ROLE_LABEL[a.role]})</option>)}
            </NativeSelect>
          )}
        </Field>
        <p className="text-xs text-muted-foreground">El Excel trae todos los movimientos de la cuenta desde el saldo de apertura: cargos, pagos y ajustes.</p>
      </Card>

      <Card>
        {o.error ? (
          <div className="p-5"><ErrorState message={o.error.message} onRetry={() => o.refetch()} /></div>
        ) : !o.data ? (
          <RowsSkeleton rows={5} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-6">
              <div>
                <h2 className="text-[15px] font-bold">Unidad {o.data.unit} · {o.data.person.name}</h2>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">{ROLE_LABEL[o.data.role]} · <StatusPill status={o.data.status} /></p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Saldo</p>
                <p className={cn('num text-2xl font-bold', o.data.overdue_months.length ? 'text-bad' : 'text-ok')}>{money(o.data.balance, true)}</p>
                <p className="text-xs text-muted-foreground">{owedText(o.data)}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 px-5 sm:px-6">
              <Button asChild>
                <a href={apiUrl(`occupancies/${o.data.id}/exports/movements`)} download><DownloadIcon />Cuenta corriente completa (Excel)</a>
              </Button>
              <Button variant="outline" onClick={() => unit.open(o.data!.id)}><PanelRightOpenIcon />Abrir ficha</Button>
            </div>
            <div className="mt-4 border-t border-line px-5 py-4 sm:px-6">
              <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Últimos movimientos</p>
              {o.data.movements.length ? (
                <table className="w-full text-[13px]">
                  <tbody>
                    {o.data.movements.map((m) => (
                      <tr key={m.id} className="border-b border-line last:border-0">
                        <td className="num py-2 pr-3 whitespace-nowrap text-muted-foreground">{dateShort(m.date)}</td>
                        <td className="w-full py-2 pr-3">{m.concept}</td>
                        <td className={cn('num py-2 pr-3 text-right whitespace-nowrap', Number(m.credit) && 'text-ok')}>
                          {Number(m.debit) ? money(m.debit) : Number(m.credit) ? '− ' + money(m.credit) : ''}
                        </td>
                        <td className="num py-2 text-right whitespace-nowrap text-muted-foreground">{money(m.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[13px] text-muted-foreground">Sin movimientos.</p>
              )}
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span className="rounded-md bg-brand-soft px-2 py-0.5 font-semibold text-brand">Próximamente</span>Buscador de pagos de toda la cartera por fecha, persona o monto.</p>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
