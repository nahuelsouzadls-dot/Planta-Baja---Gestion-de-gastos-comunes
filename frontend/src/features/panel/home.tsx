import { Link } from 'react-router'
import { AlertTriangleIcon, ArrowRightIcon, ClockIcon, InboxIcon, MessageSquareIcon, PlusIcon, WalletIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton, Tooltip } from '@/components/ui/misc'
import { Empty, Pill, ROLE_LABEL, type Tone } from '@/components/shared'
import { date, fileLabel, initials, money, monthLong, monthTitle, monthWord, MONTHS_SHORT, plural } from '@/lib/format'
import type { Portfolio } from '@/lib/types'
import { cn, pct } from '@/lib/utils'
import { Fig, Figs, legend, matchesQuery, pctBar, pctTone, SectionTitle, useOverlay } from './bits'
import { useHistory, usePanel } from './data'

export function HomePage({ portfolio }: { portfolio: Portfolio }) {
  const { orgs, orgId, query } = usePanel()
  const receipt = useOverlay('comprobante')
  const alta = useOverlay('alta')
  const company = orgs.find((o) => o.id === orgId)?.name ?? ''
  const T = portfolio.portfolio_totals
  const { month, buildings, receipt_queue: queue } = portfolio
  const unloaded = buildings.filter((b) => b.settlement !== 'issued').length
  const p = pct(T.collected, T.expected)
  const dueDays = Array.from(new Set(buildings.map((b) => b.due_day)))
  const visible = buildings.filter((b) => matchesQuery(b.name + ' ' + b.address, query))

  return (
    <div className="grid animate-enter gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <h1 className="text-[28px] leading-tight font-bold">Cartera de {company}</h1>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>{monthTitle(month)}</span>
            <span>{plural(buildings.length, 'edificio', 'edificios')}</span>
            <span>{plural(T.accounts, 'cuenta', 'cuentas')}</span>
            {dueDays.length === 1 ? <span>Vencimiento: día {dueDays[0]}</span> : null}
          </div>
        </div>
        <Button variant="outline" onClick={() => alta.open('edificio')}>
          <PlusIcon />
          Nuevo edificio
        </Button>
      </header>

      <Figs>
        <Fig icon={<WalletIcon />} label={`Cobrado en ${monthWord(month)}`} value={money(T.collected)} tone="ok" foot={`de ${money(T.expected)} · ${p} %`} bar={p} />
        <Fig icon={<ClockIcon />} label="En revisión" value={money(T.in_review)} tone="warn" foot={plural(queue.length, 'comprobante por validar', 'comprobantes por validar')} />
        <Fig icon={<AlertTriangleIcon />} label="Deuda vencida" value={money(T.debt)} tone="bad" foot={plural(T.delinquent, 'cuenta morosa', 'cuentas morosas')} />
        <Fig
          icon={<MessageSquareIcon />}
          label="Reclamos abiertos"
          tone="brand"
          value={String(T.open_claims)}
          foot={unloaded ? `${plural(unloaded, 'edificio', 'edificios')} sin gastos del mes` : 'Todos los meses cargados'}
        />
      </Figs>

      <Card>
        <SectionTitle hint="Contrastalos con la cuenta del banco antes de aprobar.">Comprobantes para validar</SectionTitle>
        <div className="p-2 sm:p-3">
          {queue.length ? (
            <ul>
              {queue.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => receipt.open(r.id)}
                    className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-3 text-left transition-colors hover:bg-brand-soft sm:grid-cols-[auto_1fr_auto_auto]"
                  >
                    <span className="grid size-9 place-items-center rounded-full bg-warn-bg text-[12px] font-bold text-warn" aria-hidden="true">{initials(r.person)}</span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">{r.person}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.building}, apto {r.unit} · {ROLE_LABEL[r.role]} · {fileLabel(r.file)} · transferido el {date(r.date)}
                      </span>
                    </span>
                    <span className="num text-[14px] font-semibold text-warn">{money(r.amount)}</span>
                    <span className="hidden h-8 items-center gap-1.5 rounded-full bg-brand-soft px-3.5 text-[13px] font-semibold text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-white sm:inline-flex">
                      Revisar <ArrowRightIcon className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<InboxIcon />} title="Nada por validar" className="m-2 border-none">No hay comprobantes esperando validación.</Empty>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle>Edificios</SectionTitle>
        <div className="p-2 sm:p-3">
          {visible.length ? (
            <ul className="grid gap-1">
              {visible.map((b) => {
                const bp = pct(b.collected, b.expected)
                const rev = Number(b.expected) ? Math.min(pct(b.in_review, b.expected), 100 - bp) : 0
                const issued = b.settlement === 'issued'
                const [tone, status]: [Tone, string] = b.counts.moroso > 0 ? ['bad', 'Con morosos'] : b.counts.revision > 0 || !issued ? ['warn', 'Requiere atención'] : ['ok', 'Al día']
                return (
                  <li key={b.id}>
                    <Link
                      to={`/panel/edificio/${b.id}`}
                      className="group grid items-center gap-x-6 gap-y-3 rounded-xl px-4 py-3.5 transition-colors hover:bg-brand-soft md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_140px_20px]"
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[14px] font-semibold transition-colors group-hover:text-brand">{b.name}</span>
                          <Pill tone={tone} className="shrink-0">{status}</Pill>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{b.address} · {b.units} unidades</span>
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-baseline justify-between gap-3 text-xs">
                          {issued ? <b className={cn('num text-[13px] font-bold', pctTone(bp))}>{bp} % cobrado</b> : <b className="text-[13px] font-semibold text-muted-foreground">Sin liquidación</b>}
                          {issued ? <span className="num truncate text-muted-foreground">{money(b.collected)} de {money(b.expected)}</span> : null}
                        </span>
                        <span className="mt-1.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className="h-full rounded-full bg-ok" style={{ width: `${bp}%` }} />
                          <span className="h-full rounded-full bg-brand-amber/70" style={{ width: `${rev}%` }} />
                        </span>
                        <span className="mt-1.5 block truncate text-xs text-muted-foreground">
                          {issued ? legend(b.counts) : <span className="font-medium text-warn">{b.settlement === 'draft' ? 'Falta emitir' : 'Faltan cargar'} los gastos de {monthLong(month)}</span>}
                        </span>
                      </span>
                      <span className="md:text-right">
                        <small className="block text-[11.5px] text-muted-foreground">Deuda vencida</small>
                        <span className={cn('num text-[14px] font-semibold', Number(b.debt) > 0 ? 'text-bad' : 'text-ok')}>{money(b.debt)}</span>
                      </span>
                      <ArrowRightIcon className="hidden size-4 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1 group-hover:text-brand md:block" aria-hidden="true" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Empty title="Sin resultados" className="m-2 border-none">Ningún edificio coincide con la búsqueda.</Empty>
          )}
        </div>
      </Card>

      <CollectionChart />
    </div>
  )
}

/** % cobrado sobre lo emitido, por mes. Una sola serie; el color de cada barra sigue el umbral (verde ≥ 90, ámbar < 60). */
function CollectionChart() {
  const { orgId } = usePanel()
  const q = useHistory(orgId, true)
  return (
    <Card>
      <SectionTitle hint="Porcentaje cobrado sobre lo emitido, en todos los edificios. Verde desde 90 %, ámbar por debajo de 60 %.">Cobrado por mes</SectionTitle>
      <div className="px-5 pt-4 pb-5 sm:px-6">
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : !q.data?.length ? (
          <p className="text-[13px] text-muted-foreground">Todavía no hay liquidaciones emitidas.</p>
        ) : (
          <>
            <div className="flex h-40 items-end gap-4 border-b border-line" role="img" aria-label="Porcentaje cobrado por mes">
              {q.data.map((m) => {
                const p = pct(m.collected, m.charged)
                return (
                  <Tooltip key={m.month} side="top" content={<span className="num">{monthLong(m.month)}: {money(m.collected)} de {money(m.charged)}</span>}>
                    <div className="group/bar flex h-full max-w-24 flex-1 cursor-default flex-col items-center justify-end gap-1.5">
                      <span className={cn('num text-xs font-bold', pctTone(p))}>{p} %</span>
                      <span className="flex w-full max-w-12 flex-1 items-end">
                        <span className={cn('w-full rounded-t-[6px] transition-opacity duration-300 group-hover/bar:opacity-80', pctBar(p))} style={{ height: `${Math.max(p, 1)}%` }} />
                      </span>
                    </div>
                  </Tooltip>
                )
              })}
            </div>
            <div className="mt-1.5 flex gap-4">
              {q.data.map((m) => <span key={m.month} className="max-w-24 flex-1 text-center text-xs text-muted-foreground">{MONTHS_SHORT[Number(m.month.slice(5)) - 1]}</span>)}
            </div>
            <table className="sr-only">
              <caption>Cobrado por mes</caption>
              <tbody>{q.data.map((m) => <tr key={m.month}><th>{monthLong(m.month)}</th><td>{money(m.collected)} de {money(m.charged)}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </div>
    </Card>
  )
}
