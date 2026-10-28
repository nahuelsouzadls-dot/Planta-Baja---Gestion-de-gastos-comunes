import * as React from 'react'
import { CalendarCheckIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/form'
import { Chip } from '@/components/ui/misc'
import { Empty, ErrorState, useDocumentTitle } from '@/components/shared'
import type { Portfolio, Task } from '@/lib/types'
import { cn } from '@/lib/utils'
import { RowsSkeleton, shortName } from './bits'
import { useAddTask, usePanel, useTasks, useToggleTask } from './data'

type Group = 'late' | 'today' | 'tomorrow' | 'next' | 'none' | 'done'
const GROUPS: [Group, string][] = [
  ['late', 'Vencidas'],
  ['today', 'Hoy'],
  ['tomorrow', 'Mañana'],
  ['next', 'Próximas'],
  ['none', 'Sin fecha'],
  ['done', 'Hechas'],
]

const GROUP_TONE: Record<Group, [string, string]> = {
  late: ['text-bad', 'bg-bad'],
  today: ['text-brand', 'bg-brand'],
  tomorrow: ['text-muted-foreground', 'bg-acc'],
  next: ['text-muted-foreground', 'bg-accl'],
  none: ['text-muted-foreground', 'bg-muted-foreground/40'],
  done: ['text-muted-foreground', 'bg-ok'],
}

/** Agenda de la administración: tareas y visitas de cada edificio, ordenadas por cuándo vencen. */
export function AgendaPage({ portfolio }: { portfolio: Portfolio }) {
  useDocumentTitle('Agenda · Administración')
  const { orgId, today } = usePanel()
  const tasks = useTasks(orgId)
  const add = useAddTask(orgId)
  const toggle = useToggleTask()
  const [filter, setFilter] = React.useState('all')
  const [text, setText] = React.useState('')
  const [bid, setBid] = React.useState(portfolio.buildings[0]?.id ?? '')

  const name = (id: string) => shortName(portfolio.buildings.find((b) => b.id === id)?.name ?? '')
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5)
  const groupOf = (t: Task): Group => {
    if (t.done) return 'done'
    if (!t.due_date) return 'none'
    const d = days(t.due_date)
    return d < 0 ? 'late' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'next'
  }
  const visible = (tasks.data ?? []).filter((t) => filter === 'all' || t.building_id === filter)
  const open = visible.filter((t) => !t.done).length

  return (
    <div className="grid gap-6 pt-2">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-bold">Agenda</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">Tareas y visitas de cada edificio. {open ? `${open} pendientes.` : 'Todo al día.'}</p>
        </div>
      </header>

      <Card className="p-4 sm:p-5">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = text.trim().slice(0, 90)
            if (!t) return
            add.mutate({ building_id: bid, text: t }, { onSuccess: () => { setText(''); toast.success('Tarea agregada') }, onError: (err) => toast.error(err.message) })
          }}
        >
          <Input aria-label="Nueva tarea" placeholder="Nueva tarea, ej.: limpieza de tanques" maxLength={90} value={text} onChange={(e) => setText(e.target.value)} className="min-w-[220px] flex-1" />
          <NativeSelect aria-label="Edificio" value={bid} onChange={(e) => setBid(e.target.value)} className="w-48">
            {portfolio.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
          <Button type="submit" disabled={add.isPending || !text.trim()}>
            {add.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            Agregar
          </Button>
        </form>
      </Card>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por edificio">
        {[['all', 'Todos'] as const, ...portfolio.buildings.map((b) => [b.id, shortName(b.name)] as const)].map(([id, label]) => (
          <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>{label}</Chip>
        ))}
      </div>

      {tasks.error ? (
        <ErrorState message={tasks.error.message} onRetry={() => tasks.refetch()} />
      ) : tasks.isPending ? (
        <Card><RowsSkeleton rows={4} /></Card>
      ) : !visible.length ? (
        <Card><Empty icon={<CalendarCheckIcon />} title="Sin tareas" className="m-2 border-none">Anotá visitas, vencimientos o pendientes de cada edificio para organizar el día.</Empty></Card>
      ) : (
        <div className="grid gap-5">
          {GROUPS.map(([g, label]) => {
            const list = visible.filter((t) => groupOf(t) === g).sort((x, y) => (x.due_date || '9').localeCompare(y.due_date || '9'))
            if (!list.length) return null
            return (
              <section key={g}>
                <h2 className={cn('mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wider uppercase', GROUP_TONE[g][0])}>
                  <span className={cn('size-2 rounded-full', GROUP_TONE[g][1])} aria-hidden="true" />
                  {label} <span className="num font-medium opacity-70">{list.length}</span>
                </h2>
                <Card className="divide-y divide-line">
                  {list.map((t) => (
                    <label key={t.id} className={cn('flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-brand-soft sm:px-5', t.done && 'opacity-55')}>
                      <input type="checkbox" checked={t.done} onChange={() => toggle.mutate(t.id, { onError: (e) => toast.error(e.message) })} className="size-4 shrink-0 accent-[var(--brand)]" />
                      <span className={cn('min-w-0 flex-1 text-[14px]', t.done && 'line-through')}>{t.text}</span>
                      <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-[11.5px] font-medium text-brand">{name(t.building_id)}</span>
                    </label>
                  ))}
                </Card>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
