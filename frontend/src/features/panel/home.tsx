import { Link } from 'react-router'
import { AlertTriangleIcon, ArrowRightIcon, ClockIcon, InboxIcon, MessageSquareIcon, WalletIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Empty, ROLE_LABEL } from '@/components/shared'
import { date, fileLabel, money, monthLong, monthTitle, monthWord, plural } from '@/lib/format'
import type { Portfolio } from '@/lib/types'
import { cn, pct } from '@/lib/utils'
import { Fig, Figs, legend, matchesQuery, SectionTitle, useOverlay } from './bits'
import { usePanel } from './data'

export function HomePage({ portfolio }: { portfolio: Portfolio }) {
  const { orgs, orgId, query } = usePanel()
  const receipt = useOverlay('comprobante')
  const company = orgs.find((o) => o.id === orgId)?.name ?? ''
  const T = portfolio.portfolio_totals
  const { month, buildings, receipt_queue: queue } = portfolio
  const unloaded = buildings.filter((b) => b.settlement !== 'issued').length
  const p = pct(T.collected, T.expected)
  const dueDays = Array.from(new Set(buildings.map((b) => b.due_day)))
  const visible = buildings.filter((b) => matchesQuery(b.name + ' ' + b.address, query))

  return (
    <div className="grid animate-enter gap-6">
      <header className="pt-2">
        <h1 className="text-[28px] leading-tight font-bold">Cartera de {company}</h1>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span>{monthTitle(month)}</span>
          <span>{plural(buildings.length, 'edificio', 'edificios')}</span>
          <span>{plural(T.accounts, 'cuenta', 'cuentas')}</span>
          {dueDays.length === 1 ? <span>Vencimiento: día {dueDays[0]}</span> : null}
        </div>
      </header>

      <Figs>
        <Fig icon={<WalletIcon />} label={`Cobrado en ${monthWord(month)}`} value={money(T.collected)} foot={`de ${money(T.expected)} · ${p} %`} bar={p} />
        <Fig icon={<ClockIcon />} label="En revisión" value={money(T.in_review)} tone="warn" foot={plural(queue.length, 'comprobante por validar', 'comprobantes por validar')} />
        <Fig icon={<AlertTriangleIcon />} label="Deuda vencida" value={money(T.debt)} tone="bad" foot={plural(T.delinquent, 'cuenta morosa', 'cuentas morosas')} />
        <Fig
          icon={<MessageSquareIcon />}
          label="Reclamos abiertos"
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
                    className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent sm:grid-cols-[1fr_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">{r.person}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.building}, apto {r.unit} · {ROLE_LABEL[r.role]} · {fileLabel(r.file)} · transferido el {date(r.date)}
                      </span>
                    </span>
                    <span className="num text-[14px]">{money(r.amount)}</span>
                    <span className="hidden items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:flex">
                      Ver comprobante <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
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
                const [dot, dotLabel] = b.counts.moroso > 0 ? ['bg-bad', 'Con morosos'] : b.counts.revision > 0 || !issued ? ['bg-[#d99a1e]', 'Requiere atención'] : ['bg-ok', 'Al día']
                return (
                  <li key={b.id}>
                    <Link
                      to={`/panel/edificio/${b.id}`}
                      className={cn(
                        'group relative grid items-center gap-x-6 gap-y-3 rounded-lg px-4 py-3.5 transition-colors hover:bg-accent md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_140px_20px]',
                        b.severe && 'bg-bad-bg/60 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-bad hover:bg-bad-bg',
                      )}
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot)} title={dotLabel} aria-label={dotLabel} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold">{b.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{b.address} · {b.units} unidades</span>
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-baseline justify-between gap-3 text-xs">
                          <b className="num text-[13px] font-semibold">{bp} %</b>
                          <span className="num truncate text-muted-foreground">{money(b.collected)} de {money(b.expected)}</span>
                        </span>
                        <span className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className="h-full bg-acc" style={{ width: `${bp}%` }} />
                          <span className="h-full bg-[#e5b453]" style={{ width: `${rev}%` }} />
                        </span>
                        <span className="mt-1.5 block truncate text-xs text-muted-foreground">
                          {issued ? legend(b.counts) : <span className="font-medium text-warn">{b.settlement === 'draft' ? 'Falta emitir' : 'Faltan cargar'} los gastos de {monthLong(month)}</span>}
                        </span>
                      </span>
                      <span className="md:text-right">
                        <small className="block text-[11.5px] text-muted-foreground">Deuda vencida</small>
                        <span className={cn('num text-[14px] font-medium', Number(b.debt) > 0 && 'text-bad')}>{money(b.debt)}</span>
                      </span>
                      <ArrowRightIcon className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground md:block" aria-hidden="true" />
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
    </div>
  )
}
