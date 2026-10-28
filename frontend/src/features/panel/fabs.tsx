import * as React from 'react'
import { useMatch, useNavigate } from 'react-router'
import { AlertTriangleIcon, BarChart3Icon, CheckIcon, ListTodoIcon, Loader2Icon, PlusIcon, ZapIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form'
import { Chip, Popover, PopoverContent, PopoverTrigger, Skeleton, Tooltip } from '@/components/ui/misc'
import { Empty } from '@/components/shared'
import { money, monthLong, MONTHS_SHORT, plural } from '@/lib/format'
import type { Portfolio } from '@/lib/types'
import { cn, pct } from '@/lib/utils'
import { shortName, useOverlay } from './bits'
import { useAddTask, useHistory, usePanel, useTasks, useToggleTask } from './data'

type PanelId = 'sc' | 'ch' | 'tk'

/** Botones flotantes abajo a la derecha: atajos, cobrado por mes y tareas (DISENO.md). */
export function Fabs({ portfolio }: { portfolio: Portfolio }) {
  const { orgId } = usePanel()
  const tasks = useTasks(orgId)
  const [open, setOpen] = React.useState<PanelId | null>(null)
  const openTasks = (tasks.data ?? []).filter((t) => !t.done).length

  const fab = (id: PanelId, label: string, icon: React.ReactNode, body: React.ReactNode, count = 0) => (
    <Popover open={open === id} onOpenChange={(o) => setOpen(o ? id : null)}>
      <Tooltip content={label} side="left">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              'relative grid size-11 place-items-center rounded-full border border-border bg-card text-foreground shadow-[0_6px_20px_rgb(11_18_32/0.12)] transition-[transform,background-color,color] hover:-translate-y-0.5 [&_svg]:size-[18px]',
              open === id && 'border-foreground bg-foreground text-white',
            )}
          >
            {icon}
            {count ? <span className="num absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-side px-1 text-[11px] font-bold text-white ring-2 ring-background">{count}</span> : null}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="left" align="end" sideOffset={12} className="w-[340px] max-w-[calc(100vw-5rem)] p-4">
        {body}
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="no-print fixed right-4 bottom-4 z-20 flex flex-row gap-2.5 sm:right-6 sm:bottom-6 sm:flex-col" role="toolbar" aria-label="Paneles">
      {fab('sc', 'Atajos', <ZapIcon />, <Shortcuts portfolio={portfolio} onGo={() => setOpen(null)} />)}
      {fab('ch', 'Cobrado por mes', <BarChart3Icon />, <Chart />)}
      {fab('tk', 'Tareas', <ListTodoIcon />, <Tasks portfolio={portfolio} />, openTasks)}
    </div>
  )
}

function PanelTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-bold">{children}</h2>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Shortcuts({ portfolio, onGo }: { portfolio: Portfolio; onGo: () => void }) {
  const navigate = useNavigate()
  const receipt = useOverlay('comprobante')
  const { buildings, receipt_queue: queue } = portfolio
  if (!buildings.length) return <><PanelTitle>Atajos</PanelTitle><p className="text-[13px] text-muted-foreground">Todavía no hay edificios.</p></>
  const noCur = buildings.filter((b) => b.settlement !== 'issued')
  const worst = buildings.slice().sort((x, y) => y.counts.moroso - x.counts.moroso)[0]
  const item = (icon: React.ReactNode, title: string, hint: string, onClick: () => void, tone?: 'bad') => (
    <button type="button" onClick={() => { onGo(); onClick() }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent">
      <span className={cn('grid size-9 place-items-center rounded-md bg-acc-soft text-[color-mix(in_srgb,var(--acc)_75%,#000)] [&_svg]:size-4', tone === 'bad' && 'bg-bad-bg text-bad')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
  return (
    <>
      <PanelTitle>Atajos</PanelTitle>
      <div className="grid gap-0.5">
        {item(<PlusIcon />, 'Cargar gastos del mes', noCur.length ? `${noCur.map((b) => shortName(b.name)).join(', ')} sin cargar` : 'Todo al día', () =>
          navigate(`/panel/edificio/${(noCur[0] ?? buildings[0]).id}/gastos?gastos=nuevo`),
        )}
        {item(<CheckIcon />, 'Revisar comprobantes', `${queue.length} esperando`, () => (queue[0] ? receipt.open(queue[0].id) : navigate('/panel')))}
        {item(<AlertTriangleIcon />, 'Ver morosos', plural(portfolio.portfolio_totals.delinquent, 'cuenta', 'cuentas'), () => navigate(`/panel/edificio/${worst.id}/resumen`), 'bad')}
      </div>
    </>
  )
}

/** % cobrado sobre lo emitido, por mes. Una sola serie: un tono, sin leyenda; el % va arriba de cada barra. */
function Chart() {
  const { orgId } = usePanel()
  const q = useHistory(orgId, true)
  return (
    <>
      <PanelTitle hint="Porcentaje cobrado sobre lo emitido, en todos los edificios.">Cobrado por mes</PanelTitle>
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.length ? (
        <p className="text-[13px] text-muted-foreground">Todavía no hay liquidaciones emitidas.</p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-3 border-b border-line px-1" role="img" aria-label="Porcentaje cobrado por mes">
            {q.data.map((m) => {
              const p = pct(m.collected, m.charged)
              return (
                <Tooltip key={m.month} side="top" content={<span className="num">{monthLong(m.month)}: {money(m.collected)} de {money(m.charged)}</span>}>
                  <div className="group flex h-full flex-1 cursor-default flex-col items-center justify-end gap-1.5">
                    <span className="num text-[11.5px] font-semibold text-ink-2">{p}%</span>
                    <span className="flex w-full max-w-9 flex-1 items-end">
                      <span className="w-full rounded-t-[4px] bg-acc transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(p, 1)}%` }} />
                    </span>
                  </div>
                </Tooltip>
              )
            })}
          </div>
          <div className="mt-1.5 flex gap-3 px-1">
            {q.data.map((m) => <span key={m.month} className="flex-1 text-center text-[11.5px] text-muted-foreground">{MONTHS_SHORT[Number(m.month.slice(5)) - 1]}</span>)}
          </div>
          {/* Vista de tabla para lectores de pantalla */}
          <table className="sr-only">
            <caption>Cobrado por mes</caption>
            <tbody>{q.data.map((m) => <tr key={m.month}><th>{monthLong(m.month)}</th><td>{money(m.collected)} de {money(m.charged)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </>
  )
}

function Tasks({ portfolio }: { portfolio: Portfolio }) {
  const { orgId, today } = usePanel()
  const inBuilding = useMatch('/panel/edificio/:id/*')
  const tasks = useTasks(orgId)
  const add = useAddTask(orgId)
  const toggle = useToggleTask()
  const [filter, setFilter] = React.useState('all')
  const [text, setText] = React.useState('')
  const [bid, setBid] = React.useState(portfolio.buildings[0]?.id ?? '')
  const scope = inBuilding ? inBuilding.params.id! : filter === 'all' ? null : filter
  const name = (id: string) => shortName(portfolio.buildings.find((b) => b.id === id)?.name ?? '')
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5)
  const list = (tasks.data ?? [])
    .filter((t) => !scope || t.building_id === scope)
    .sort((x, y) => Number(x.done) - Number(y.done) || (x.due_date || '9').localeCompare(y.due_date || '9'))

  return (
    <>
      <PanelTitle hint={scope ? name(scope) : 'Toda la cartera'}>Tareas</PanelTitle>
      {!inBuilding ? (
        <div className="-mx-1 mb-3 flex flex-wrap gap-1" role="group" aria-label="Filtrar tareas por edificio">
          {[['all', 'Todas'], ...portfolio.buildings.map((b) => [b.id, shortName(b.name)])].map(([id, label]) => (
            <Chip key={id} active={filter === id} onClick={() => setFilter(id)} className="h-7 px-2.5">{label}</Chip>
          ))}
        </div>
      ) : null}
      {tasks.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : list.length ? (
        <ul className="-mx-1 grid max-h-64 gap-0.5 overflow-y-auto">
          {list.map((t) => {
            const dd = t.due_date ? days(t.due_date) : null
            return (
              <li key={t.id}>
                <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-accent', t.done && 'opacity-55')}>
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => toggle.mutate(t.id, { onError: (e) => toast.error(e.message) })}
                    className="mt-0.5 size-4 shrink-0 accent-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', t.done && 'line-through')}>{t.text}</span>
                    <span className="flex gap-2 text-[11.5px] text-muted-foreground">
                      <b className="font-medium">{name(t.building_id)}</b>
                      {dd !== null && !t.done ? (
                        <span className={cn(dd <= 1 && 'font-medium text-bad')}>{dd < 0 ? 'Vencida' : dd === 0 ? 'Hoy' : dd === 1 ? 'Mañana' : `En ${dd} días`}</span>
                      ) : null}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty className="py-5" title="Sin tareas pendientes" />
      )}
      <form
        className="mt-3 grid gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim().slice(0, 90)
          if (!t) return
          add.mutate({ building_id: inBuilding ? inBuilding.params.id! : bid, text: t }, { onSuccess: () => setText(''), onError: (err) => toast.error(err.message) })
        }}
      >
        <div className="flex gap-2">
          <input
            aria-label="Nueva tarea"
            placeholder="Nueva tarea"
            maxLength={90}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-[13px] outline-none focus-visible:border-acc focus-visible:ring-[3px] focus-visible:ring-acc-soft"
          />
          <Button type="submit" size="sm" disabled={add.isPending || !text.trim()}>
            {add.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            Sumar
          </Button>
        </div>
        {!inBuilding ? (
          <NativeSelect aria-label="Edificio" value={bid} onChange={(e) => setBid(e.target.value)} className="[&_select]:h-8 [&_select]:text-[13px]">
            {portfolio.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        ) : null}
      </form>
    </>
  )
}
