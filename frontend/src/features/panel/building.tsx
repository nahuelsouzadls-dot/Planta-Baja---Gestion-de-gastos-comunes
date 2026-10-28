import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  AlertTriangleIcon, ChevronRightIcon, ClockIcon, DownloadIcon, EyeIcon, FileSpreadsheetIcon,
  FileTextIcon, Loader2Icon, MegaphoneIcon, MessageSquareIcon, PiggyBankIcon, PlusIcon, SendIcon, WalletIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FormError, Input, NativeSelect, Textarea } from '@/components/ui/form'
import { Chip, Count, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc'
import { Empty, ErrorState, Pill, ROLE_LABEL, StatusPill, useDocumentTitle, type Tone } from '@/components/shared'
import { api, apiUrl, openSigned } from '@/lib/api'
import { date, dateShort, money, monthLong, monthShort, monthTitle, monthWord, percent, plural } from '@/lib/format'
import type { AccountStatus, ClaimStatus, Portfolio, PortfolioBuilding } from '@/lib/types'
import { cn, pct } from '@/lib/utils'
import { Fig, Figs, FigsSkeleton, hasTenant, matchesQuery, RowsSkeleton, SectionTitle, sortedAccounts, useOverlay } from './bits'
import { useBuilding, useClaim, useClaimStatus, useIssueSettlement, usePanel, usePublishNotice, useReplyClaim, type BuildingData } from './data'
import { ExpenseDialog } from './expense-dialog'

const TABS = [['cobros', 'Cobros'], ['resumen', 'Resumen'], ['gastos', 'Gastos'], ['comunicaciones', 'Comunicaciones']] as const
type Tab = (typeof TABS)[number][0]

export function BuildingPage({ portfolio }: { portfolio: Portfolio }) {
  const { id, tab: rawTab } = useParams()
  const navigate = useNavigate()
  const b = portfolio.buildings.find((x) => x.id === id)
  const q = useBuilding(b?.id)
  const expense = useOverlay('gastos')
  const tab: Tab = (TABS.some(([t]) => t === rawTab) ? rawTab : 'cobros') as Tab
  useDocumentTitle(b ? `${b.name} · Administración` : 'Administración')

  if (!b) return <ErrorState message="No encontramos ese edificio." onRetry={() => navigate('/panel')} />
  const d = q.data
  const openClaims = d ? d.claims.filter((c) => c.status !== 'resolved').length : 0

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="min-w-0">
          <nav aria-label="Ruta" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/panel" className="hover:text-foreground hover:underline">Cartera</Link>
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
        <div className="flex gap-2">
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
              {t === 'comunicaciones' ? <Count n={openClaims} /> : null}
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
          {tab === 'comunicaciones' ? <Comunicaciones b={b} d={d} /> : null}
        </div>
      )}

      {d ? <ExpenseDialog building={b} data={d} month={portfolio.month} /> : null}
    </div>
  )
}

// ── Cobros ─────────────────────────────────────────────────────────────
const FILTERS = [['todos', 'Todos'], ['revision', 'En revisión'], ['moroso', 'Morosos'], ['pendiente', 'Pendientes'], ['pagado', 'Al día']] as const

function BuildingFigs({ b, d, month }: { b: PortfolioBuilding; d: BuildingData; month: string }) {
  const p = pct(b.collected, b.expected)
  return (
    <Figs>
      <Fig icon={<WalletIcon />} label={`Cobrado en ${monthWord(month)}`} value={money(b.collected)} foot={`de ${money(b.expected)} · ${p} %`} bar={p} />
      <Fig icon={<ClockIcon />} label="En revisión" value={money(b.in_review)} tone="warn" foot={plural(b.counts.revision, 'comprobante', 'comprobantes')} />
      <Fig icon={<AlertTriangleIcon />} label="Deuda vencida" value={money(b.debt)} tone="bad" foot={plural(b.counts.moroso, 'cuenta morosa', 'cuentas morosas')} />
      <Fig icon={<PiggyBankIcon />} label="Fondo de reserva" value={money(d.summary.funds.reserve)} foot="Acumulado a la fecha" />
    </Figs>
  )
}

function Cobros({ b, d, month }: { b: PortfolioBuilding; d: BuildingData; month: string }) {
  const { query } = usePanel()
  const unit = useOverlay('unidad')
  const receipt = useOverlay('comprobante')
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
                  <tr key={a.id} className={cn('group cursor-pointer transition-colors hover:bg-accent', first && i > 0 && 'border-t border-line')} onClick={() => unit.open(a.id)}>
                    <td className="rounded-l-lg px-3 py-2.5">
                      <button type="button" className="flex items-center gap-3 text-left" onClick={(e) => { e.stopPropagation(); unit.open(a.id) }}>
                        <span className="num w-10 shrink-0 text-[13px] font-semibold">{first ? a.unit : ''}</span>
                        <span>
                          <span className="block font-medium">{a.person.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {ROLE_LABEL[a.role]}{a.role === 'owner' && hasTenant(all, a.unit) ? ' · fondo y extraordinarios' : ''}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="num px-3 py-2.5 text-right">{Number(a.charge) ? money(a.charge) : '—'}</td>
                    <td className={cn('num px-3 py-2.5 text-right', late && 'font-semibold text-bad')}>{money(a.balance)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-0.5">
                        <StatusPill status={a.status} />
                        {late ? <span className="text-[11.5px] text-bad">{plural(late, 'mes', 'meses')} de atraso</span> : null}
                      </div>
                    </td>
                    <td className="rounded-r-lg px-3 py-2.5 text-right">
                      {a.status === 'revision' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async (e) => {
                            e.stopPropagation()
                            const o = await api.get<{ pending_receipt: { id: string } | null }>(`occupancies/${a.id}`).catch(() => null)
                            if (o?.pending_receipt) receipt.open(o.pending_receipt.id)
                            else toast('Esta cuenta ya no tiene comprobantes en revisión.')
                          }}
                        >
                          <EyeIcon />
                          Ver comprobante
                        </Button>
                      ) : (
                        <ChevronRightIcon className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visible.length ? null : <Empty title="Sin resultados" className="m-2 border-none">Ninguna cuenta coincide con el filtro.</Empty>}
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
              ['Fondo de reserva', money(s.funds.reserve)],
              ['Cobrado este mes', money(s.funds.collected)],
              ['Por cobrar', money(s.funds.receivable)],
              ['Coeficientes asignados', percent(s.funds.coefficient_sum)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between border-b border-line py-3 text-[13px] last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="num text-[14px] font-medium">{v}</dd>
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
                    <tr key={m.unit + m.role} className="cursor-pointer transition-colors hover:bg-accent" onClick={() => occ && unit.open(occ)}>
                      <td className="num rounded-l-lg px-3 py-2.5 font-semibold">{m.unit}</td>
                      <td className="px-3 py-2.5">{m.person} <span className="text-muted-foreground">· {ROLE_LABEL[m.role]}</span></td>
                      <td className="px-3 py-2.5">{m.months.map(monthShort).join(', ')}</td>
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
                    <tr key={e.month} className="border-t border-line first:border-0">
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

// ── Comunicaciones ─────────────────────────────────────────────────────
function Comunicaciones({ b, d }: { b: PortfolioBuilding; d: BuildingData }) {
  const [sub, setSub] = React.useState<'avisos' | 'hilos'>('avisos')
  return (
    <>
      <div className="flex gap-1" role="group" aria-label="Comunicaciones">
        <Chip active={sub === 'avisos'} onClick={() => setSub('avisos')}>Avisos <span className="num opacity-60">{d.notices.length}</span></Chip>
        <Chip active={sub === 'hilos'} onClick={() => setSub('hilos')}>Reclamos y reportes <span className="num opacity-60">{d.claims.length}</span></Chip>
      </div>
      {sub === 'avisos' ? <Avisos b={b} d={d} /> : <Hilos d={d} />}
    </>
  )
}

function Avisos({ b, d }: { b: PortfolioBuilding; d: BuildingData }) {
  const publish = usePublishNotice(b.id)
  const [error, setError] = React.useState('')
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
      <Card>
        <SectionTitle hint={`Lo ven todos los residentes de ${b.name} en su portal.`}>Nuevo aviso</SectionTitle>
        <form
          className="grid gap-4 p-5 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const form = e.currentTarget
            const data = new FormData(form)
            const title = String(data.get('title') || '').trim()
            const body = String(data.get('body') || '').trim()
            if (title.length < 3) return setError('El asunto necesita al menos 3 caracteres.')
            if (body.length < 10) return setError('El mensaje es muy corto.')
            setError('')
            publish.mutate({ title, body }, { onSuccess: () => { form.reset(); toast.success('Aviso publicado') }, onError: (err) => setError(err.message) })
          }}
        >
          <Field label="Asunto" htmlFor="n-t"><Input id="n-t" name="title" maxLength={120} /></Field>
          <Field label="Mensaje" htmlFor="n-b"><Textarea id="n-b" name="body" rows={5} maxLength={1200} /></Field>
          <FormError>{error}</FormError>
          <Button type="submit" className="justify-self-start" disabled={publish.isPending}>
            {publish.isPending ? <Loader2Icon className="animate-spin" /> : <MegaphoneIcon />}
            Publicar aviso
          </Button>
        </form>
      </Card>
      <Card>
        <SectionTitle>Publicados</SectionTitle>
        <div className="px-5 pb-2 sm:px-6">
          {d.notices.length ? (
            d.notices.map((n) => (
              <article key={n.id} className="border-b border-line py-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <h3 className="text-[14px] font-bold">{n.title}</h3>
                  <time dateTime={n.date} className="text-xs text-muted-foreground">{date(n.date)}</time>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{n.body}</p>
              </article>
            ))
          ) : (
            <Empty icon={<MegaphoneIcon />} title="Sin avisos" className="my-4 border-none">Todavía no hay avisos publicados.</Empty>
          )}
        </div>
      </Card>
    </div>
  )
}

const THREAD_STATUS: Record<ClaimStatus, [Tone, string]> = {
  pending: ['pend', 'Pendiente'],
  in_progress: ['warn', 'En proceso'],
  resolved: ['ok', 'Resuelto'],
}

const kindLabel = (k: string) => (k === 'complaint' ? 'Reclamo' : 'Reporte')

function Hilos({ d }: { d: BuildingData }) {
  const [picked, setPicked] = React.useState<string | null>(null)
  const curId = picked && d.claims.some((c) => c.id === picked) ? picked : d.claims[0]?.id ?? null
  const thread = useClaim(curId)
  const reply = useReplyClaim()
  const setStatus = useClaimStatus()
  const [text, setText] = React.useState('')

  if (!d.claims.length) return <Card><Empty icon={<MessageSquareIcon />} title="Sin reclamos" className="m-2 border-none">No hay reclamos ni reportes de este edificio.</Empty></Card>

  return (
    <Card className="grid overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
      <ul className="max-h-[560px] overflow-y-auto border-b border-line p-2 lg:border-r lg:border-b-0">
        {d.claims.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setPicked(t.id)}
              aria-current={curId === t.id}
              className={cn('grid w-full gap-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent', curId === t.id && 'bg-acc-soft hover:bg-acc-soft')}
            >
              <span className="truncate text-[13px] font-semibold">{t.title}</span>
              <span className="text-xs text-muted-foreground">{t.author} · apto {t.unit} · {kindLabel(t.kind)}</span>
              <span><Pill tone={THREAD_STATUS[t.status][0]}>{THREAD_STATUS[t.status][1]}</Pill></span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-col">
        {!thread.data ? (
          <RowsSkeleton rows={3} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold">{thread.data.title}</h2>
                <p className="text-xs text-muted-foreground">{thread.data.author} · apto {thread.data.unit} · {date(thread.data.date)}</p>
              </div>
              <NativeSelect
                aria-label="Estado"
                className="w-36"
                value={thread.data.status}
                disabled={setStatus.isPending}
                onChange={(e) =>
                  setStatus.mutate(
                    { id: thread.data!.id, status: e.target.value as ClaimStatus },
                    { onSuccess: () => toast.success('Estado actualizado'), onError: (err) => toast.error(err.message) },
                  )
                }
              >
                {(Object.keys(THREAD_STATUS) as ClaimStatus[]).map((k) => <option key={k} value={k}>{THREAD_STATUS[k][1]}</option>)}
              </NativeSelect>
            </div>
            <div className="grid flex-1 content-start gap-3 bg-muted/40 p-5">
              {thread.data.messages.map((m) => (
                <div key={m.id} className={cn('max-w-[80%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed', m.from_admin ? 'justify-self-end rounded-br-sm bg-side text-white' : 'justify-self-start rounded-bl-sm border border-border bg-card')}>
                  <p className={cn('mb-0.5 text-[11px]', m.from_admin ? 'text-white/70' : 'text-muted-foreground')}>{m.author} · {dateShort(m.date)}</p>
                  {m.text}
                </div>
              ))}
            </div>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault()
                const t = text.trim()
                if (!t || !curId) return
                reply.mutate({ id: curId, text: t }, { onSuccess: () => setText(''), onError: (err) => toast.error(err.message) })
              }}
            >
              <Input aria-label="Respuesta" placeholder="Escribir respuesta…" maxLength={1000} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" disabled={reply.isPending || !text.trim()}>
                {reply.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                Enviar
              </Button>
            </form>
          </>
        )}
      </div>
    </Card>
  )
}
