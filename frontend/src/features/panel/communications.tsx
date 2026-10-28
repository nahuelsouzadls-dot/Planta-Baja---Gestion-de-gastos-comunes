import * as React from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, MegaphoneIcon, MessageSquareIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FormError, Input, NativeSelect, Textarea } from '@/components/ui/form'
import { Chip } from '@/components/ui/misc'
import { Empty, ErrorState, Pill, useDocumentTitle, type Tone } from '@/components/shared'
import { api } from '@/lib/api'
import { date, dateShort } from '@/lib/format'
import type { ClaimStatus, ClaimSummary, Notice, Portfolio } from '@/lib/types'
import { cn } from '@/lib/utils'
import { RowsSkeleton, SectionTitle, shortName } from './bits'
import { useClaim, useClaimStatus, useReplyClaim } from './data'

export const THREAD_STATUS: Record<ClaimStatus, [Tone, string]> = {
  pending: ['pend', 'Pendiente'],
  in_progress: ['warn', 'En proceso'],
  resolved: ['ok', 'Resuelto'],
}
const kindLabel = (k: string) => (k === 'complaint' ? 'Reclamo' : 'Reporte')

type ClaimRow = ClaimSummary & { buildingId: string; building: string }
type NoticeRow = Notice & { buildingId: string; building: string }

/** Reclamos y avisos de todos los edificios en una sola bandeja. */
function useInbox(portfolio: Portfolio) {
  const buildings = portfolio.buildings
  const claims = useQueries({
    queries: buildings.map((b) => ({
      queryKey: ['panel', 'claims', b.id],
      queryFn: async () => (await api.get<{ claims: ClaimSummary[] }>(`buildings/${b.id}/claims`)).claims,
    })),
  })
  const notices = useQueries({
    queries: buildings.map((b) => ({
      queryKey: ['panel', 'notices', b.id],
      queryFn: async () => (await api.get<{ notices: Notice[] }>(`buildings/${b.id}/notices`)).notices,
    })),
  })
  const pending = claims.some((q) => q.isPending) || notices.some((q) => q.isPending)
  const error = claims.find((q) => q.error)?.error ?? notices.find((q) => q.error)?.error ?? null
  const claimRows: ClaimRow[] = claims
    .flatMap((q, i) => (q.data ?? []).map((c) => ({ ...c, buildingId: buildings[i].id, building: buildings[i].name })))
    .sort((x, y) => Number(x.status === 'resolved') - Number(y.status === 'resolved') || y.date.localeCompare(x.date))
  const noticeRows: NoticeRow[] = notices
    .flatMap((q, i) => (q.data ?? []).map((n) => ({ ...n, buildingId: buildings[i].id, building: buildings[i].name })))
    .sort((x, y) => y.date.localeCompare(x.date))
  return { pending, error, claims: claimRows, notices: noticeRows }
}

export function CommunicationsPage({ portfolio }: { portfolio: Portfolio }) {
  useDocumentTitle('Comunicaciones · Administración')
  const inbox = useInbox(portfolio)
  const [sub, setSub] = React.useState<'reclamos' | 'avisos'>('reclamos')
  const [filter, setFilter] = React.useState('all')
  const byBuilding = <T extends { buildingId: string }>(rows: T[]) => rows.filter((r) => filter === 'all' || r.buildingId === filter)
  const claims = byBuilding(inbox.claims)
  const notices = byBuilding(inbox.notices)
  const open = inbox.claims.filter((c) => c.status !== 'resolved').length

  return (
    <div className="grid gap-6 pt-2">
      <header>
        <h1 className="text-[28px] leading-tight font-bold">Comunicaciones</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Reclamos de los residentes y avisos de todos los edificios. {open ? `${open} reclamos abiertos.` : 'Sin reclamos abiertos.'}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label="Tipo">
          <Chip active={sub === 'reclamos'} onClick={() => setSub('reclamos')}>Reclamos y reportes <span className="num opacity-60">{claims.length}</span></Chip>
          <Chip active={sub === 'avisos'} onClick={() => setSub('avisos')}>Avisos <span className="num opacity-60">{notices.length}</span></Chip>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por edificio">
          {[['all', 'Todos'] as const, ...portfolio.buildings.map((b) => [b.id, shortName(b.name)] as const)].map(([id, label]) => (
            <Chip key={id} active={filter === id} onClick={() => setFilter(id)} className="h-7 px-2.5">{label}</Chip>
          ))}
        </div>
      </div>

      {inbox.error ? (
        <ErrorState message={(inbox.error as Error).message} />
      ) : inbox.pending ? (
        <Card><RowsSkeleton rows={5} /></Card>
      ) : sub === 'reclamos' ? (
        <Claims rows={claims} />
      ) : (
        <Notices rows={notices} portfolio={portfolio} defaultBuilding={filter === 'all' ? 'all' : filter} />
      )}
    </div>
  )
}

function Claims({ rows }: { rows: ClaimRow[] }) {
  const [picked, setPicked] = React.useState<string | null>(null)
  const curId = picked && rows.some((c) => c.id === picked) ? picked : rows[0]?.id ?? null
  const thread = useClaim(curId)
  const reply = useReplyClaim()
  const setStatus = useClaimStatus()
  const [text, setText] = React.useState('')
  const building = rows.find((c) => c.id === curId)?.building

  if (!rows.length) return <Card><Empty icon={<MessageSquareIcon />} title="Sin reclamos" className="m-2 border-none">No hay reclamos ni reportes de los residentes.</Empty></Card>

  return (
    <Card className="grid overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
      <ul className="max-h-[620px] overflow-y-auto border-b border-line p-2 lg:border-r lg:border-b-0">
        {rows.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setPicked(t.id)}
              aria-current={curId === t.id}
              className={cn('grid w-full gap-1 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent', curId === t.id && 'bg-acc-soft hover:bg-acc-soft')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">{t.title}</span>
                <Pill tone={THREAD_STATUS[t.status][0]}>{THREAD_STATUS[t.status][1]}</Pill>
              </span>
              <span className="truncate text-xs text-muted-foreground">{shortName(t.building)} · apto {t.unit} · {t.author}</span>
              <span className="text-[11.5px] text-muted-foreground">{kindLabel(t.kind)} · {dateShort(t.date)}</span>
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
                <p className="text-xs text-muted-foreground">{building} · apto {thread.data.unit} · {thread.data.author} · {date(thread.data.date)}</p>
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
                <div key={m.id} className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed', m.from_admin ? 'justify-self-end rounded-br-md bg-[var(--brand)] text-white' : 'justify-self-start rounded-bl-md border border-border bg-card')}>
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

function Notices({ rows, portfolio, defaultBuilding }: { rows: NoticeRow[]; portfolio: Portfolio; defaultBuilding: string }) {
  const qc = useQueryClient()
  const [target, setTarget] = React.useState(defaultBuilding)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  async function publish(form: HTMLFormElement) {
    const data = new FormData(form)
    const title = String(data.get('title') || '').trim()
    const body = String(data.get('body') || '').trim()
    if (title.length < 3) return setError('El asunto necesita al menos 3 caracteres.')
    if (body.length < 10) return setError('El mensaje es muy corto.')
    const ids = target === 'all' ? portfolio.buildings.map((b) => b.id) : [target]
    setError('')
    setBusy(true)
    try {
      // Un aviso por edificio: cada uno lo ven sus residentes.
      for (const id of ids) await api.post(`buildings/${id}/notices`, { title, body })
      await qc.invalidateQueries({ queryKey: ['panel'] })
      form.reset()
      toast.success(ids.length > 1 ? `Aviso publicado en ${ids.length} edificios` : 'Aviso publicado')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
      <Card>
        <SectionTitle hint="Lo ven los residentes del edificio elegido en su portal.">Nuevo aviso</SectionTitle>
        <form className="grid gap-4 p-5 sm:p-6" noValidate onSubmit={(e) => { e.preventDefault(); publish(e.currentTarget) }}>
          <Field label="Para" htmlFor="n-to">
            <NativeSelect id="n-to" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="all">Todos los edificios</option>
              {portfolio.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Asunto" htmlFor="n-t"><Input id="n-t" name="title" maxLength={120} /></Field>
          <Field label="Mensaje" htmlFor="n-b"><Textarea id="n-b" name="body" rows={5} maxLength={1200} /></Field>
          <FormError>{error}</FormError>
          <Button type="submit" className="justify-self-start" disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <MegaphoneIcon />}
            Publicar aviso
          </Button>
        </form>
      </Card>
      <Card>
        <SectionTitle>Publicados</SectionTitle>
        <div className="px-5 pb-2 sm:px-6">
          {rows.length ? (
            rows.map((n) => (
              <article key={n.buildingId + n.id} className="border-b border-line py-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <h3 className="text-[14px] font-bold">{n.title}</h3>
                  <time dateTime={n.date} className="text-xs text-muted-foreground">{date(n.date)}</time>
                </div>
                <p className="mt-0.5 text-xs font-medium text-[var(--brand)]">{n.building}</p>
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
