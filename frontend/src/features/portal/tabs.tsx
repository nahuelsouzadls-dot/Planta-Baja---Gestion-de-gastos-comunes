import * as React from 'react'
import {
  ArrowLeftIcon, BellIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon,
  FileTextIcon, Loader2Icon, MessageSquareIcon, PrinterIcon, ReceiptIcon, SendIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FormError, Input, Textarea } from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger, Skeleton } from '@/components/ui/misc'
import { Empty, ErrorState, Pill, ROLE_LABEL, type Tone } from '@/components/shared'
import { api, apiUrl, openSigned } from '@/lib/api'
import { date, dateShort, fileLabel, money, monthLong, monthTitle, MONTHS_SHORT, percent, plural } from '@/lib/format'
import type { ClaimKind, ClaimStatus, PortalAccount, PortalMonth, PortalReceipt, ReceiptStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useClaims, useCreateClaim, useMonths, useMovements, useNotices, useReceiptFile, useReceipts, useReply, useSettlement, useThread } from './data'

const YEARS_BACK = 5
const DOT: Record<PortalMonth['status'], [string, string]> = {
  ok: ['bg-ok', 'Pagado'],
  warn: ['bg-[#d99a1e]', 'Pendiente'],
  bad: ['bg-bad', 'Vencido'],
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-6 py-1">
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

// ── Mi liquidación ─────────────────────────────────────────────────────
function MonthPicker({ months, statusOf, value, onChange, currentMonth }: { months: string[]; statusOf: (m: string) => PortalMonth['status']; value: string; onChange: (m: string) => void; currentMonth: string }) {
  const [open, setOpen] = React.useState(false)
  const curYear = Number(currentMonth.slice(0, 4))
  const [year, setYear] = React.useState(Number(value.slice(0, 4)))
  const i = months.indexOf(value)
  const [dot] = DOT[statusOf(value)]

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" aria-label="Mes anterior" disabled={i >= months.length - 1} onClick={() => onChange(months[i + 1])}>
        <ChevronLeftIcon />
      </Button>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setYear(Number(value.slice(0, 4))) }}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-52 justify-between font-semibold" aria-haspopup="listbox">
            <span className="flex items-center gap-2.5">
              <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
              {monthTitle(value)}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <div className="mb-2 flex items-center justify-between">
            <Button variant="ghost" size="icon-sm" aria-label="Año anterior" disabled={year <= curYear - YEARS_BACK} onClick={() => setYear(year - 1)}>
              <ChevronLeftIcon />
            </Button>
            <b className="num text-sm">{year}</b>
            <Button variant="ghost" size="icon-sm" aria-label="Año siguiente" disabled={year >= curYear} onClick={() => setYear(year + 1)}>
              <ChevronRightIcon />
            </Button>
          </div>
          <div role="listbox" aria-label={`Meses de ${year}`} className="grid grid-cols-4 gap-1">
            {MONTHS_SHORT.map((label, m) => {
              const k = `${year}-${String(m + 1).padStart(2, '0')}`
              const has = months.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  role="option"
                  aria-selected={k === value}
                  disabled={!has}
                  onClick={() => { onChange(k); setOpen(false) }}
                  className={cn(
                    'flex h-9 items-center justify-center gap-1.5 rounded-md text-[13px] transition-colors',
                    has ? 'hover:bg-accent' : 'cursor-default text-muted-foreground/40',
                    k === value && 'bg-foreground font-semibold text-background hover:bg-foreground',
                  )}
                >
                  {has ? <span className={cn('size-1.5 rounded-full', DOT[statusOf(k)][0])} aria-hidden="true" /> : null}
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-muted-foreground">
            {Object.values(DOT).map(([cls, label]) => (
              <span key={label} className="flex items-center gap-1.5"><span className={cn('size-1.5 rounded-full', cls)} />{label}</span>
            ))}
          </p>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon" aria-label="Mes siguiente" disabled={i <= 0} onClick={() => onChange(months[i - 1])}>
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

export function LiquidacionTab({ account, currentMonth }: { account: PortalAccount; currentMonth: string }) {
  const id = account.id
  const monthsQ = useMonths(id)
  const [picked, setPicked] = React.useState<string | null>(null)
  const [showMoves, setShowMoves] = React.useState(false)
  const months = React.useMemo(() => (monthsQ.data ?? []).map((m) => m.month).sort().reverse(), [monthsQ.data])
  const month = picked && months.includes(picked) ? picked : months[0]
  const detail = useSettlement(id, month)
  const moves = useMovements(id, showMoves)

  if (monthsQ.isPending) return <ListSkeleton rows={6} />
  if (monthsQ.error) return <ErrorState message={monthsQ.error.message} onRetry={() => monthsQ.refetch()} />
  if (!months.length) return <Empty icon={<FileTextIcon />} title="Todavía no hay liquidaciones publicadas">Cuando la administración emita el mes, aparece acá con el detalle de cada gasto.</Empty>

  const statusOf = (m: string) => monthsQ.data?.find((x) => x.month === m)?.status ?? 'ok'
  const d = detail.data

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Liquidación de {monthLong(month)}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {d ? `Tu coeficiente: ${percent(d.coefficient)} · ` : ''}
            {ROLE_LABEL[account.role]}
          </p>
        </div>
        <MonthPicker months={months} statusOf={statusOf} value={month} onChange={setPicked} currentMonth={currentMonth} />
      </div>

      {/* Encabezado solo para imprimir */}
      <p className="hidden print:block">
        <strong>{account.organization}</strong> · {account.building}<br />
        {account.name} · Apto {account.unit} · {ROLE_LABEL[account.role]}
      </p>

      {detail.isPending ? (
        <ListSkeleton rows={6} />
      ) : detail.error ? (
        <ErrorState message={detail.error.message} onRetry={() => detail.refetch()} />
      ) : d ? (
        <div>
          {d.lines.map((l) => (
            <div key={l.concept} className="flex items-baseline justify-between gap-6 border-b border-line py-3">
              <div className="min-w-0">
                <p className="text-[14px]">{l.concept}</p>
                <p className="text-xs text-muted-foreground">{l.detail || `Total del edificio ${money(l.building_total)}`}</p>
              </div>
              <span className="num text-[14px]">{money(l.amount, true)}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-6 border-t-2 border-foreground/80 pt-3.5">
            <span className="text-[15px] font-bold">Total {monthLong(month)}</span>
            <span className="num text-[17px] font-semibold">{money(d.total, true)}</span>
          </div>
        </div>
      ) : null}

      <div className="no-print flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => openSigned(api.get(`portal/occupancies/${id}/settlements/${month}/pdf`)).catch(() => window.print())}
        >
          <PrinterIcon />
          Imprimir o guardar PDF
        </Button>
        <Button
          variant="outline"
          onClick={() => openSigned(api.get(`portal/occupancies/${id}/settlements/${month}/building-pdf`)).catch((e) => toast.error(e.message))}
        >
          <FileTextIcon />
          Liquidación del edificio
        </Button>
        <Button variant="ghost" onClick={() => setShowMoves((s) => !s)} aria-expanded={showMoves}>
          {showMoves ? 'Ocultar mis movimientos' : 'Ver mis movimientos'}
        </Button>
      </div>

      {showMoves ? (
        <div className="no-print rounded-lg border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-bold">Tus movimientos</h3>
            <Button asChild variant="link" size="sm">
              <a href={apiUrl(`portal/occupancies/${id}/exports/movements`)} download>
                <DownloadIcon />
                Excel
              </a>
            </Button>
          </div>
          {moves.isPending ? (
            <div className="p-4"><ListSkeleton /></div>
          ) : moves.data?.length ? (
            <ul>
              {moves.data.slice(0, 8).map((m) => (
                <li key={m.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                  <span className="num text-xs text-muted-foreground">{dateShort(m.date)}</span>
                  <span className="min-w-0 truncate">{m.concept}</span>
                  <span className={cn('num', Number(m.credit) && 'text-ok')}>
                    {Number(m.debit) ? money(m.debit, true) : '− ' + money(m.credit, true)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-muted-foreground">Sin movimientos.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ── Mis comprobantes ───────────────────────────────────────────────────
const RECEIPT_STATUS: Record<ReceiptStatus, [Tone, string]> = {
  approved: ['ok', 'Aprobado'],
  pending: ['warn', 'En revisión'],
  rejected: ['bad', 'Rechazado'],
}

export function ComprobantesTab({ account, onUploadAgain }: { account: PortalAccount; onUploadAgain: () => void }) {
  const q = useReceipts(account.id)
  const [open, setOpen] = React.useState<PortalReceipt | null>(null)

  if (q.isPending) return <ListSkeleton />
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  if (!q.data.length)
    return <Empty icon={<ReceiptIcon />} title="Todavía no subiste comprobantes">Cuando transfieras, subí la foto o el PDF del banco desde la tarjeta de pago.</Empty>

  return (
    <>
      <ul className="grid gap-2">
        {q.data.map((r) => {
          const [tone, label] = RECEIPT_STATUS[r.status]
          return (
            <li key={r.id} className="rounded-lg border border-border">
              <button type="button" onClick={() => setOpen(r)} className="flex w-full items-center gap-3 rounded-lg px-3.5 py-3 sm:gap-4 sm:px-4 text-left transition-colors hover:bg-accent/60">
                <span className="hidden size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground sm:grid"><ReceiptIcon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">Pago de {monthLong(r.month)}</span>
                  <span className="block text-xs text-muted-foreground">{money(r.amount, true)} · transferido el {dateShort(r.date)}</span>
                </span>
                <Pill tone={tone}>{label}</Pill>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </button>
              {r.status === 'rejected' ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-bad-bg/50 px-4 py-2.5 text-[13px] text-bad">
                  <span>Motivo: {r.reason || 'no pudimos verificar la transferencia.'}</span>
                  <Button variant="link" size="sm" className="text-bad" onClick={onUploadAgain}>Subir uno nuevo</Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <ReceiptDialog receipt={open} account={account} onClose={() => setOpen(null)} />
    </>
  )
}

function ReceiptDialog({ receipt, account, onClose }: { receipt: PortalReceipt | null; account: PortalAccount; onClose: () => void }) {
  const file = useReceiptFile(receipt?.id ?? null)
  const r = receipt
  return (
    <Dialog open={Boolean(r)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Comprobante</DialogTitle>
          <DialogDescription>Los datos que declaraste al subirlo.</DialogDescription>
        </DialogHeader>
        {r ? (
          <div className="grid gap-4">
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Transferencia</p>
              <p className="num text-2xl font-semibold">{money(r.declared_amount, true)}</p>
              <dl className="mt-3 grid gap-1.5 text-[13px]">
                {[['Fecha', date(r.date)], ['Destino', account.organization], ['Concepto', account.concept], ['Nota', r.note || '—']].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
                ))}
              </dl>
            </div>
            {file.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : !file.data ? (
              <p className="text-[13px] text-muted-foreground">{fileLabel(r.file)} · el archivo no está disponible.</p>
            ) : file.data.content_type.startsWith('image/') ? (
              <a href={file.data.url} target="_blank" rel="noopener">
                <img src={file.data.url} alt="Comprobante subido" className="max-h-[50vh] w-full rounded-lg bg-muted object-contain" />
              </a>
            ) : (
              <Button asChild variant="outline">
                <a href={file.data.url} target="_blank" rel="noopener"><FileTextIcon />Abrir el PDF del comprobante</a>
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ── Avisos ─────────────────────────────────────────────────────────────
export function AvisosTab({ account, today }: { account: PortalAccount; today: string }) {
  const q = useNotices(account.id)
  if (q.isPending) return <ListSkeleton />
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  if (!q.data.length) return <Empty icon={<BellIcon />} title="No hay avisos">Los avisos de la administración para tu edificio aparecen acá.</Empty>
  const recent = (iso: string) => (Date.parse(today) - Date.parse(iso)) / 86_400_000 <= 7
  return (
    <div className="divide-y divide-line">
      {q.data.map((n) => (
        <article key={n.id} className="py-4 first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="flex items-center gap-2 text-[15px] font-bold">
              {n.title}
              {recent(n.date) ? <span className="rounded-full bg-acc-soft px-2 py-0.5 text-[11px] font-semibold text-[color-mix(in_srgb,var(--acc)_70%,#000)]">Nuevo</span> : null}
            </h3>
            <time dateTime={n.date} className="text-xs text-muted-foreground">{date(n.date)}</time>
          </div>
          <p className="mt-1.5 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{n.body}</p>
        </article>
      ))}
    </div>
  )
}

// ── Problemas y reclamos ───────────────────────────────────────────────
export const THREAD_STATUS: Record<ClaimStatus, [Tone, string]> = {
  pending: ['pend', 'Recibido'],
  in_progress: ['warn', 'En proceso'],
  resolved: ['ok', 'Resuelto'],
}
const kindLabel = (k: ClaimKind) => (k === 'complaint' ? 'Reclamo' : 'Reporte')

function Thread({ claimId, onBack, accountId }: { claimId: string; onBack: () => void; accountId: string }) {
  const q = useThread(claimId)
  const reply = useReply(accountId)
  const [text, setText] = React.useState('')
  const endRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [q.data?.messages.length])

  return (
    <div className="grid gap-5">
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}>
        <ArrowLeftIcon />
        Volver a mis reclamos
      </Button>
      {q.isPending ? (
        <ListSkeleton rows={3} />
      ) : q.error ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{q.data.title}</h2>
              <p className="text-[13px] text-muted-foreground">{kindLabel(q.data.kind)} · {date(q.data.date)}</p>
            </div>
            <Pill tone={THREAD_STATUS[q.data.status][0]}>{THREAD_STATUS[q.data.status][1]}</Pill>
          </div>
          <div className="grid gap-3 rounded-lg bg-muted/50 p-4">
            {q.data.messages.map((m) => (
              <div key={m.id} className={cn('max-w-[85%] rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed', m.from_admin ? 'justify-self-start rounded-bl-sm border border-border bg-card' : 'justify-self-end rounded-br-sm bg-[#166aa3] text-white')}>
                <p className={cn('mb-0.5 text-[11.5px]', m.from_admin ? 'text-muted-foreground' : 'text-white/70')}>{m.author} · {dateShort(m.date)}</p>
                {m.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {q.data.status !== 'resolved' ? (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const t = text.trim()
                if (!t) return
                reply.mutate({ claimId, text: t }, { onSuccess: () => setText(''), onError: (err) => toast.error(err.message) })
              }}
            >
              <label htmlFor="c-reply" className="text-xs font-medium text-ink-2">Tu respuesta</label>
              <div className="flex items-end gap-2">
                <Textarea id="c-reply" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribí un mensaje a la administración" className="min-h-11" />
                <Button type="submit" variant="theme" size="icon" className="size-11" aria-label="Enviar mensaje" disabled={reply.isPending || !text.trim()}>
                  {reply.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-[13px] text-muted-foreground">Este reclamo está resuelto. Si el problema sigue, abrí uno nuevo.</p>
          )}
        </>
      )}
    </div>
  )
}

export function ReclamosTab({ account }: { account: PortalAccount }) {
  const q = useClaims(account.id)
  const create = useCreateClaim(account.id)
  const [thread, setThread] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<ClaimKind>('report')
  const [error, setError] = React.useState('')

  if (thread) return <Thread claimId={thread} accountId={account.id} onBack={() => setThread(null)} />

  return (
    <div className="grid gap-8">
      {q.isPending ? (
        <ListSkeleton rows={2} />
      ) : q.data?.length ? (
        <div>
          <h2 className="mb-2 text-[15px] font-bold">Tus reclamos</h2>
          <ul className="grid gap-2">
            {q.data.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setThread(t.id)} className="flex w-full items-center gap-3 rounded-lg border border-border px-3.5 py-3 sm:gap-4 sm:px-4 text-left transition-colors hover:bg-accent/60">
                  <span className="hidden size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground sm:grid"><MessageSquareIcon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{t.title}</span>
                    <span className="block text-xs text-muted-foreground">{kindLabel(t.kind)} · {date(t.date)} · {plural(t.message_count, 'mensaje', 'mensajes')}</span>
                  </span>
                  <Pill tone={THREAD_STATUS[t.status][0]}>{THREAD_STATUS[t.status][1]}</Pill>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        className="grid gap-4 rounded-lg border border-border p-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const data = new FormData(form)
          const title = String(data.get('title') || '').trim()
          const body = String(data.get('body') || '').trim()
          if (title.length < 4) return setError('Contanos en pocas palabras qué pasa.')
          setError('')
          create.mutate(
            { kind, title, body: body || title },
            {
              onSuccess: (claim) => {
                form.reset()
                setThread(claim.id)
                toast.success('Enviado. La administración te va a responder acá.')
              },
              onError: (err) => setError(err.message),
            },
          )
        }}
      >
        <div>
          <h2 className="text-[15px] font-bold">Avisar un problema</h2>
          <p className="text-[13px] text-muted-foreground">Te respondemos acá mismo y podés seguir la conversación.</p>
        </div>
        <div className="grid gap-1.5">
          <span id="k-l" className="text-xs font-medium text-ink-2">¿De qué se trata?</span>
          <div role="radiogroup" aria-labelledby="k-l" className="grid gap-2 sm:grid-cols-2">
            {([['report', 'Algo se rompió o no funciona'], ['complaint', 'Reclamo a la administración']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn('rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors', kind === k ? 'border-foreground bg-card font-semibold ring-1 ring-foreground' : 'border-border hover:bg-accent')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Field label="¿Qué pasa?" htmlFor="c-t">
          <Input id="c-t" name="title" maxLength={120} placeholder="Ej.: no anda el portero eléctrico" />
        </Field>
        <Field label="Contanos más (opcional)" htmlFor="c-b">
          <Textarea id="c-b" name="body" rows={3} maxLength={1000} />
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" variant="theme" className="justify-self-start" disabled={create.isPending}>
          {create.isPending ? <Loader2Icon className="animate-spin" /> : null}
          Enviar a la administración
        </Button>
      </form>
    </div>
  )
}
