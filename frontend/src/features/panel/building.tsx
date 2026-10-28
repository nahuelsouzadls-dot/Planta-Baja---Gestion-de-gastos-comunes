import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  AlertTriangleIcon, ChevronRightIcon, ClockIcon, DownloadIcon, EyeIcon, FileSpreadsheetIcon,
  FileTextIcon, Loader2Icon, PiggyBankIcon, PlusIcon, WalletIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip, Count, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc'
import { Empty, ErrorState, Pill, ROLE_LABEL, StatusPill, useDocumentTitle } from '@/components/shared'
import { api, apiUrl, openSigned } from '@/lib/api'
import { money, monthLong, monthShort, monthTitle, monthWord, percent, plural } from '@/lib/format'
import type { AccountStatus, Portfolio, PortfolioBuilding } from '@/lib/types'
import { cn, pct } from '@/lib/utils'
import { Fig, Figs, FigsSkeleton, hasTenant, matchesQuery, RowsSkeleton, SectionTitle, sortedAccounts, useOverlay } from './bits'
import { useBuilding, useIssueSettlement, usePanel, type BuildingData } from './data'
import { ExpenseDialog } from './expense-dialog'

const TABS = [['cobros', 'Cobros'], ['resumen', 'Resumen'], ['gastos', 'Gastos']] as const
type Tab = (typeof TABS)[number][0]

export function BuildingPage({ portfolio }: { portfolio: Portfolio }) {
  const { id, tab: rawTab } = useParams()
  const navigate = useNavigate()
  const b = portfolio.buildings.find((x) => x.id === id)
  const q = useBuilding(b?.id)
  const expense = useOverlay('gastos')
  const alta = useOverlay('alta')
  const tab: Tab = (TABS.some(([t]) => t === rawTab) ? rawTab : 'cobros') as Tab
  useDocumentTitle(b ? `${b.name} · Administración` : 'Administración')

  if (!b) return <ErrorState message="No encontramos ese edificio." onRetry={() => navigate('/panel')} />
  const d = q.data

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="min-w-0">
          <nav aria-label="Ruta" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/panel" className="hover:text-foreground hover:underline">Vista general</Link>
            <ChevronRightIcon className="size-3" />
            <span className="text-foreground">{b.name}</span>
          </nav>
          <h1 className="text-[28px] leading-tight font-bold">{b.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>{b.address}{b.neighborhood ? `, ${b.neighborhood}` : ''}</span>
            <span>{b.units} unidades</span>
            {d ? <span title="Suma de coeficientes de copropiedad">Coeficientes: {percent(d.summary.funds.coefficient_sum)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => alta.open(`unidad:${b.id}`)}>
            <PlusIcon />
            Agregar unidad
          </Button>
          <Button variant="outline" asChild>
            <a href={apiUrl(`buildings/${b.id}/exports/accounts?month=${portfolio.month}`)} download>
              <DownloadIcon />
              Exportar a Excel
            </a>
          </Button>
          <Button onClick={() => expense.open('nuevo')} disabled={!d}>
            <PlusIcon />
            Cargar gastos
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(t) => navigate(`/panel/edificio/${b.id}/${t}`)}>
        <TabsList aria-label="Secciones del edificio">
          {TABS.map(([t, label]) => (
            <TabsTrigger key={t} value={t}>
              {label}
              {t === 'cobros' ? <Count n={b.counts.revision} /> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {q.error ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="grid gap-6"><FigsSkeleton /><Card><RowsSkeleton rows={8} /></Card></div>
      ) : (
        <div key={tab} className="grid animate-enter gap-6">
          {tab === 'cobros' ? <Cobros b={b} d={d} month={portfolio.month} /> : null}
          {tab === 'resumen' ? <Resumen b={b} d={d} month={portfolio.month} /> : null}
          {tab === 'gastos' ? <Gastos b={b} d={d} /> : null}
        </div>
      )}

      {d ? <ExpenseDialog building={b} data={d} month={portfolio.month} /> : null}
    </div>
  )
}

// ── Cobros ─────────────────────────────────────────────────────────────
const BALANCE_TONE: Record<AccountStatus, string> = { pagado: 'text-ok', revision: 'text-warn', pendiente: '', moroso: 'text-bad', 'sin-cargar': 'text-muted-foreground' }
const FILTERS = [['todos', 'Todos'], ['revision', 'En revisión'], ['moroso', 'Morosos'], ['pendiente', 'Pendientes'], ['pagado', 'Al día']] as const

function BuildingFigs({ b, d, month }: { b: PortfolioBuilding; d: BuildingData; month: string }) {
  const p = pct(b.collected, b.expected)
  return (
    <Figs>
      <Fig icon={<WalletIcon />} label={`Cobrado en ${monthWord(month)}`} value={money(b.collected)} tone="ok" foot={`de ${money(b.expected)} · ${p} %`} bar={p} />
      <Fig icon={<ClockIcon />} label="En revisión" value={money(b.in_review)} tone="warn" foot={plural(b.counts.revision, 'comprobante', 'comprobantes')} />
      <Fig icon={<AlertTriangleIcon />} label="Deuda vencida" value={money(b.debt)} tone="bad" foot={plural(b.counts.moroso, 'cuenta morosa', 'cuentas morosas')} />
      <Fig icon={<PiggyBankIcon />} label="Fondo de reserva" value={money(d.summary.funds.reserve)} tone="brand" foot="Acumulado a la fecha" />
    </Figs>
  )
}

function Cobros({ b, d, month }: { b: PortfolioBuilding; d: BuildingData; month: string }) {
  const { query } = usePanel()
  const unit = useOverlay('unidad')
  const receipt = useOverlay('comprobante')
  const alta = useOverlay('alta')
  const [filter, setFilter] = React.useState<'todos' | AccountStatus>('todos')
  const all = sortedAccounts(d.accounts)
  const counts = all.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {})
  const visible = all.filter((a) => (filter === 'todos' || a.status === filter) && matchesQuery(a.unit + ' ' + a.person.name, query))

  return (
    <>
      <BuildingFigs b={b} d={d} month={month} />
      <Card>
        <div className="flex flex-wrap gap-1 px-4 pt-4 sm:px-5" role="group" aria-label="Filtrar por estado">
          {FILTERS.map(([f, label]) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {label} <span className="num opacity-60">{f === 'todos' ? all.length : counts[f] ?? 0}</span>
            </Chip>
          ))}
        </div>
        <div className="overflow-x-auto p-2 sm:p-3">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <th className="px-3 py-2 font-semibold">Unidad y responsable</th>
                <th className="px-3 py-2 text-right font-semibold">Cargo del mes</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a, i) => {
                const first = i === 0 || visible[i - 1].unit !== a.unit
                const late = a.overdue_months.length
                return (
                  <tr key={a.id} className={cn('group cursor-pointer transition-colors hover:bg-brand-soft', first && i > 0 && 'border-t border-line')} onClick={() => unit.open(a.id)}>
                    <td className="rounded-l-lg px-3 py-2.5">
                      <button type="button" className="flex items-center gap-3 text-left" onClick={(e) => { e.stopPropagation(); unit.open(a.id) }}>
                        <span className="num w-10 shrink-0 text-[13px] font-semibold text-brand">{first ? a.unit : ''}</span>
                        <span>
                          <span className="block font-medium">{a.person.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {ROLE_LABEL[a.role]}{a.role === 'owner' && hasTenant(all, a.unit) ? ' · fondo y extraordinarios' : ''}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="num px-3 py-2.5 text-right">{Number(a.charge) ? money(a.charge) : '—'}</td>
                    <td className={cn('num px-3 py-2.5 text-right font-semibold', BALANCE_TONE[a.status])}>{money(a.balance)}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={a.status} label={late ? `Moroso · ${plural(late, 'mes', 'meses')}` : undefined} />
                    </td>
                    <td className="rounded-r-lg px-3 py-2.5 text-right">
                      {a.status === 'revision' ? (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-soft px-3.5 text-[13px] font-semibold text-brand transition-colors duration-200 hover:bg-[#166aa3] hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          onClick={async (e) => {
                            e.stopPropagation()
                            const o = await api.get<{ pending_receipt: { id: string } | null }>(`occupancies/${a.id}`).catch(() => null)
                            if (o?.pending_receipt) receipt.open(o.pending_receipt.id)
                            else toast('Esta cuenta ya no tiene comprobantes en revisión.')
                          }}
                        >
                          <EyeIcon className="size-3.5" />
                          Revisar comprobante
                        </button>
                      ) : (
                        <ChevronRightIcon className="ml-auto size-4 text-brand opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visible.length ? null : all.length ? (
            <Empty title="Sin resultados" className="m-2 border-none">Ninguna cuenta coincide con el filtro.</Empty>
          ) : (
            <Empty icon={<PlusIcon />} title="Este edificio todavía no tiene unidades" className="m-2 border-none">
              <p>Cargá cada unidad con su propietario y su coeficiente de copropiedad.</p>
              <Button className="mt-3" onClick={() => alta.open(`unidad:${b.id}`)}><PlusIcon />Agregar la primera unidad</Button>
            </Empty>
          )}
        </div>
      </Card>
    </>
  )
}

// ── Resumen ────────────────────────────────────────────────────────────
function Resumen({ b, d, month }: { b: PortfolioBuilding; d: BuildingData; month: string }) {
  const unit = useOverlay('unidad')
  const expense = useOverlay('gastos')
  const navigate = useNavigate()
  const s = d.summary
  const current = d.settlements.find((x) => x.month === month)
  const items = s.items.filter((it) => Number(it.amount) > 0)
  const max = Math.max(...items.map((it) => Number(it.amount)), 1)
  const accountId = (u: string, role: string) => d.accounts.find((a) => a.unit === u && a.role === role)?.id

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle hint={b.settlement === 'issued' ? <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-accl" />Los paga siempre el propietario.</span> : undefined}>
            Gastos de {monthLong(month)}
          </SectionTitle>
          <div className="px-5 pt-3 pb-5 sm:px-6">
            {b.settlement === 'issued' ? (
              <>
                <ul className="grid gap-3">
                  {items.map((it) => (
                    <li key={it.concept} className="grid grid-cols-[minmax(0,40%)_minmax(60px,1fr)_88px] items-center gap-4 text-[13px]">
                      <span className="min-w-0">
                        <span className="block truncate">{it.concept}</span>
                        {it.detail ? <span className="block truncate text-[11.5px] text-muted-foreground">{it.detail}</span> : null}
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className={cn('block h-full rounded-full', it.type === 'owner_only' ? 'bg-accl' : 'bg-acc')} style={{ width: `${(Number(it.amount) / max) * 100}%` }} />
                      </span>
                      <span className="num text-right">{money(it.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex justify-between border-t border-line pt-3 text-[14px] font-semibold">
                  <span>Total del mes</span>
                  <span className="num">{money(current?.total ?? '0')}</span>
                </div>
              </>
            ) : (
              <Empty title={b.settlement === 'draft' ? 'Gastos en borrador' : 'Sin gastos cargados'} className="border-none py-6">
                <p>
                  {b.settlement === 'draft'
                    ? `Los gastos de ${monthLong(month)} están en borrador. Emitilos desde la pestaña Gastos.`
                    : `Todavía no se cargaron los gastos de ${monthLong(month)}.`}
                </p>
                <Button className="mt-3" onClick={() => (b.settlement === 'draft' ? navigate(`/panel/edificio/${b.id}/gastos`) : expense.open('nuevo'))}>
                  {b.settlement === 'draft' ? 'Ir a Gastos' : 'Cargar gastos'}
                </Button>
              </Empty>
            )}
          </div>
        </Card>
        <Card>
          <SectionTitle>Fondos</SectionTitle>
          <dl className="px-5 pt-2 pb-4 sm:px-6">
            {[
              ['Fondo de reserva', money(s.funds.reserve), 'text-brand'],
              ['Cobrado este mes', money(s.funds.collected), 'text-ok'],
              ['Por cobrar', money(s.funds.receivable), Number(s.funds.receivable) ? 'text-warn' : ''],
              ['Coeficientes asignados', percent(s.funds.coefficient_sum), Number(s.funds.coefficient_sum) === 1 ? '' : 'text-bad'],
            ].map(([k, v, tone]) => (
              <div key={k} className="flex items-baseline justify-between border-b border-line py-3 text-[13px] last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn('num text-[14px] font-semibold', tone)}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card>
        <SectionTitle hint="Cuentas con meses vencidos.">Morosidad</SectionTitle>
        <div className="overflow-x-auto p-2 sm:p-3">
          {s.delinquent.length ? (
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <th className="px-3 py-2 font-semibold">Unidad</th>
                  <th className="px-3 py-2 font-semibold">Responsable</th>
                  <th className="px-3 py-2 font-semibold">Meses adeudados</th>
                  <th className="px-3 py-2 text-right font-semibold">Deuda vencida</th>
                </tr>
              </thead>
              <tbody>
                {s.delinquent.map((m) => {
                  const occ = accountId(m.unit, m.role)
                  return (
                    <tr key={m.unit + m.role} className="cursor-pointer transition-colors hover:bg-bad-bg/60" onClick={() => occ && unit.open(occ)}>
                      <td className="num rounded-l-lg px-3 py-2.5 font-semibold text-brand">{m.unit}</td>
                      <td className="px-3 py-2.5">{m.person} <span className="text-muted-foreground">· {ROLE_LABEL[m.role]}</span></td>
                      <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1">{m.months.map((x) => <span key={x} className="rounded-md bg-bad-bg px-1.5 py-0.5 text-[11.5px] font-medium text-bad">{monthShort(x)}</span>)}</span></td>
                      <td className="num rounded-r-lg px-3 py-2.5 text-right font-semibold text-bad">{money(m.debt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <Empty title="Sin morosidad" className="m-2 border-none">Ninguna cuenta con meses vencidos.</Empty>
          )}
        </div>
      </Card>
    </>
  )
}

// ── Gastos ─────────────────────────────────────────────────────────────
const SHORT: Record<string, string> = { 'O.S.E. (agua)': 'O.S.E.', 'U.T.E. (luz)': 'U.T.E.', 'Honorarios de administración': 'Honorarios', 'Fondo de reserva': 'F. reserva', 'Cuota extraordinaria': 'Extraord.' }

function Gastos({ b, d }: { b: PortfolioBuilding; d: BuildingData }) {
  const expense = useOverlay('gastos')
  const issue = useIssueSettlement(b.id)
  const rows = d.settlements.slice().sort((x, y) => y.month.localeCompare(x.month))
  const paper = b.settlement === 'issued' ? sortedAccounts(d.accounts).filter((a) => a.receives_paper && Number(a.charge)) : []
  const n = (v: string | undefined) => (Number(v) ? money(v).replace('$ ', '') : '—')

  return (
    <>
      {paper.length ? (
        <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 text-[13px]">
          <span className="flex items-center gap-2 font-medium"><FileTextIcon className="size-4 text-muted-foreground" />Para imprimir (reciben en papel):</span>
          {paper.map((a) => (
            <Button key={a.id} variant="link" size="sm" onClick={() => openSigned(api.get(`occupancies/${a.id}/settlements/${d.summary.month}/pdf`)).catch((e) => toast.error(e.message))}>
              Apto {a.unit} · {a.person.name}
            </Button>
          ))}
        </Card>
      ) : null}
      <Card>
        <SectionTitle
          hint="Los meses en borrador se pueden corregir. Al emitir, la liquidación queda fija en el libro mayor: cualquier corrección posterior se hace con un asiento de ajuste."
          action={<Button onClick={() => expense.open('nuevo')}><PlusIcon />Cargar mes</Button>}
        >
          Liquidaciones
        </SectionTitle>
        <div className="overflow-x-auto p-2 sm:p-3">
          {rows.length ? (
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <th className="px-3 py-2 text-left font-semibold">Mes</th>
                  {d.concepts.map((c) => <th key={c.id} className="px-3 py-2 text-right font-semibold">{SHORT[c.name] ?? c.name}</th>)}
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-left font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const by = Object.fromEntries(e.items.map((it) => [it.concept_id, it.amount]))
                  const issued = e.status === 'issued'
                  return (
                    <tr key={e.month} className="border-t border-line transition-colors first:border-0 hover:bg-brand-soft/60">
                      <td className="px-3 py-3 font-medium whitespace-nowrap">{monthTitle(e.month)}</td>
                      {d.concepts.map((c) => <td key={c.id} className="num px-3 py-3 text-right">{n(by[c.id])}</td>)}
                      <td className="num px-3 py-3 text-right font-semibold">{money(e.total)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          {issued ? <Pill tone="ok">Emitido</Pill> : <Pill tone="warn">Borrador</Pill>}
                          {issued ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => openSigned(api.get(`buildings/${b.id}/settlements/${e.month}/pdf`)).catch((err) => toast.error(err.message))}>
                                <FileTextIcon />PDF
                              </Button>
                              <Button variant="ghost" size="sm" asChild>
                                <a href={apiUrl(`buildings/${b.id}/settlements/${e.month}/export`)} download><FileSpreadsheetIcon />Excel</a>
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => expense.open(e.month)}>Editar</Button>
                              <Button
                                size="sm"
                                disabled={issue.isPending}
                                onClick={() =>
                                  issue.mutate(e.month, {
                                    onSuccess: () => toast.success(`Liquidación de ${monthLong(e.month)} emitida a los residentes`),
                                    onError: (err) => toast.error(err.message),
                                  })
                                }
                              >
                                {issue.isPending && issue.variables === e.month ? <Loader2Icon className="animate-spin" /> : null}
                                Emitir
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <Empty title="Sin gastos cargados" className="m-2 border-none">Cargá el primer mes para generar la liquidación.</Empty>
          )}
        </div>
      </Card>
    </>
  )
}
