import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightIcon, DownloadIcon, FileTextIcon, Loader2Icon, MailIcon, PhoneIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, FormError, Input, NativeSelect } from '@/components/ui/form'
import { Chip, Skeleton } from '@/components/ui/misc'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ROLE_LABEL, StatusPill } from '@/components/shared'
import { api, apiUrl, openSigned } from '@/lib/api'
import { amountText, comma, date, dateShort, fileLabel, money, monthLong, percent } from '@/lib/format'
import type { Occupancy } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useOverlay } from './bits'
import { useAdjustment, useManualPayment, useMoveOut, useNewTenant, useOccupancy, usePanel, useSale, type BuildingData, type PersonInput } from './data'
import { owedText } from './receipt-dialog'

export function UnitSheet({ month }: { month: string }) {
  const overlay = useOverlay('unidad')
  return (
    <Sheet open={Boolean(overlay.value)} onOpenChange={(o) => !o && overlay.close()}>
      <SheetContent aria-describedby={undefined}>
        {overlay.value ? <UnitBody id={overlay.value} month={month} onSwitch={overlay.open} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function UnitBody({ id, month, onSwitch }: { id: string; month: string; onSwitch: (id: string) => void }) {
  const q = useOccupancy(id)
  const qc = useQueryClient()
  const receipt = useOverlay('comprobante')
  const o = q.data

  if (q.error) return <div className="p-6"><SheetTitle className="sr-only">Detalle de unidad</SheetTitle><p className="text-[13px] text-bad">{q.error.message}</p></div>
  if (!o)
    return (
      <div className="grid gap-4 p-6" aria-busy="true" aria-label="Cargando unidad">
        <SheetTitle className="sr-only">Detalle de unidad</SheetTitle>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-4 h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )

  const all = [{ id: o.id, role: o.role, person: o.person.name }, ...o.other_occupancies].sort((x, y) => (x.role === 'owner' ? -1 : 1) - (y.role === 'owner' ? -1 : 1))
  const rented = all.some((x) => x.role === 'tenant')
  // El total lo calcula el backend (ADR-0011): es el cargo del mes de la cuenta.
  const charge = qc.getQueriesData<BuildingData>({ queryKey: ['panel', 'building'] }).flatMap(([, d]) => d?.accounts ?? []).find((a) => a.id === o.id)?.charge
  const partial = (l: Occupancy['lines'][number]) => (l.days != null && l.days_in_month && l.days !== l.days_in_month ? ` × ${l.days}/${l.days_in_month} días` : '')

  return (
    <div className="pb-6">
      <div className="px-6 pt-6 pb-5">
        <SheetTitle className="flex items-baseline gap-3 pr-10">
          <span className="num font-display text-[30px] leading-none font-bold">{o.unit}</span>
          <span className="text-[13px] font-normal text-muted-foreground">{o.floor}.º piso · {o.building}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">Cuenta de {o.person.name}</SheetDescription>
        <div className="mt-3 flex items-center gap-3">
          <StatusPill status={o.status} />
          <span className="text-xs text-muted-foreground">Coeficiente {percent(o.coefficient)}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-1" role="group" aria-label="Cuentas de la unidad">
          {all.map((x) => (
            <Chip key={x.id} active={x.id === o.id} onClick={() => x.id !== o.id && onSwitch(x.id)}>
              {ROLE_LABEL[x.role]}
              <span className="opacity-60">· {rented ? (x.role === 'tenant' ? 'gastos ordinarios' : 'reserva y extraordinarios') : 'todos los gastos'}</span>
            </Chip>
          ))}
        </div>
        <p className="mt-4 text-[15px] font-semibold">{o.person.name}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {o.person.phone ? <a href={`tel:${o.person.phone.replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-foreground"><PhoneIcon className="size-3.5" />{o.person.phone}</a> : null}
          {o.person.email ? <a href={`mailto:${o.person.email}`} className="flex items-center gap-1.5 hover:text-foreground"><MailIcon className="size-3.5" />{o.person.email}</a> : null}
        </div>
        <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Saldo</p>
          <p className={cn('num mt-1 text-[28px] leading-tight font-semibold tracking-tight', o.overdue_months.length && 'text-bad')}>{money(o.balance, true)}</p>
          <p className="text-xs text-muted-foreground">{owedText(o)}</p>
        </div>
        {o.pending_receipt ? (
          <button
            type="button"
            onClick={() => receipt.open(o.pending_receipt!.id)}
            className="group mt-3 flex w-full items-center justify-between gap-3 rounded-lg border border-warn/25 bg-warn-bg px-4 py-3 text-left transition-colors hover:border-warn/50"
          >
            <span>
              <span className="block text-[13px] font-semibold text-warn">{fileLabel(o.pending_receipt.file)} en revisión</span>
              <span className="block text-xs text-warn/80">Transferido el {date(o.pending_receipt.date)} · cubre {money(o.pending_receipt.amount, true)}</span>
            </span>
            <span className="flex items-center gap-1 text-[13px] font-medium text-warn">Revisar <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
          </button>
        ) : null}
      </div>

      <Section title={`Liquidación de ${monthLong(month)}`}>
        {o.lines.length ? (
          <>
            {o.lines.map((l) => (
              <div key={l.concept} className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
                <span className="min-w-0">
                  {l.concept}
                  <span className="block text-[11.5px] text-muted-foreground">{money(l.total)} × {percent(l.coefficient)}{partial(l)}</span>
                </span>
                <span className="num">{money(l.amount, true)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-foreground/70 pt-2.5 text-[13px] font-semibold">
              <span>Total {monthLong(month)}</span>
              <span className="num">{charge ? money(charge, true) : '—'}</span>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">Sin gastos emitidos para este mes.</p>
        )}
      </Section>

      <Section
        title="Últimos movimientos"
        action={
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href={apiUrl(`occupancies/${o.id}/exports/movements`)} download><DownloadIcon />Excel</a>
            </Button>
            {o.lines.length ? (
              <Button variant="ghost" size="sm" onClick={() => openSigned(api.get(`occupancies/${o.id}/settlements/${month}/pdf`)).catch((e) => toast.error(e.message))}>
                <FileTextIcon />PDF
              </Button>
            ) : null}
          </div>
        }
      >
        {o.movements.length ? (
          <table className="w-full text-[12.5px]">
            <tbody>
              {o.movements.map((m) => (
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
      </Section>

      <Manage o={o} rented={rented} />
    </div>
  )
}

// ── Registrar: pago sin comprobante, ajuste y ocupantes ────────────────
const MANAGE = [['payment', 'Pago sin comprobante'], ['adjust', 'Ajuste'], ['occupants', 'Ocupantes']] as const
type ManageTab = (typeof MANAGE)[number][0]

function Manage({ o, rented }: { o: Occupancy; rented: boolean }) {
  const [tab, setTab] = React.useState<ManageTab | null>(null)
  return (
    <Section title="Registrar">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Registrar en la cuenta">
        {MANAGE.map(([t, label]) => (
          <Chip key={t} active={tab === t} onClick={() => setTab(tab === t ? null : t)}>{label}</Chip>
        ))}
      </div>
      {tab ? (
        <div className="mt-4 animate-enter rounded-lg border border-border p-4">
          {tab === 'payment' ? <PaymentForm o={o} onDone={() => setTab(null)} /> : null}
          {tab === 'adjust' ? <AdjustForm o={o} onDone={() => setTab(null)} /> : null}
          {tab === 'occupants' ? <OccupantsForms o={o} rented={rented} onDone={() => setTab(null)} /> : null}
        </div>
      ) : null}
    </Section>
  )
}

function useFormRun(onDone: () => void, success: string) {
  const [error, setError] = React.useState('')
  const run = (p: Promise<unknown>) =>
    p.then(
      () => { toast.success(success); onDone() },
      (err: Error) => setError(err.message),
    )
  return { error, setError, run }
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="sm" disabled={pending} className="justify-self-start">
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  )
}

function PaymentForm({ o, onDone }: { o: Occupancy; onDone: () => void }) {
  const { today } = usePanel()
  const m = useManualPayment(o.id)
  const { error, setError, run } = useFormRun(onDone, 'Pago registrado')
  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const d = new FormData(e.currentTarget)
        const amount = amountText(String(d.get('amount') || ''))
        if (!amount) return setError('Escribí el monto (por ejemplo 4153,80).')
        run(m.mutateAsync({ amount, date: String(d.get('date') || ''), source: String(d.get('source') || '').trim() }))
      }}
    >
      <p className="text-xs text-muted-foreground">Para pagos en efectivo o depósitos sin comprobante subido. Queda en el libro mayor con la fuente que indiques.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Monto" htmlFor="mp-a"><Input id="mp-a" name="amount" inputMode="decimal" autoComplete="off" className="num" defaultValue={Number(o.balance) > 0 ? comma(o.balance) : ''} /></Field>
        <Field label="Fecha del pago" htmlFor="mp-d"><Input id="mp-d" name="date" type="date" defaultValue={today} max={today} /></Field>
      </div>
      <Field label="Cómo se verificó" htmlFor="mp-s"><Input id="mp-s" name="source" maxLength={200} placeholder="Ej.: efectivo en la oficina, recibo 0231" /></Field>
      <FormError>{error}</FormError>
      <Submit pending={m.isPending}>Registrar pago</Submit>
    </form>
  )
}

function AdjustForm({ o, onDone }: { o: Occupancy; onDone: () => void }) {
  const m = useAdjustment(o.id)
  const { error, setError, run } = useFormRun(onDone, 'Ajuste registrado')
  const targets = o.movements.filter((x) => ['charge', 'opening', 'surcharge'].includes(x.kind))
  if (!targets.length) return <p className="text-[13px] text-muted-foreground">No hay cargos recientes para ajustar.</p>
  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const d = new FormData(e.currentTarget)
        const amount = amountText(String(d.get('amount') || ''))
        if (!amount) return setError('Escribí el monto del ajuste (por ejemplo 250).')
        const signed = d.get('direction') === 'credit' ? '-' + amount : amount
        run(m.mutateAsync({ entry_id: String(d.get('entry_id')), amount: signed, description: String(d.get('description') || '').trim() }))
      }}
    >
      <p className="text-xs text-muted-foreground">Corrige un cargo sin tocar el original: se agrega un asiento de ajuste.</p>
      <Field label="Movimiento a corregir" htmlFor="aj-e">
        <NativeSelect id="aj-e" name="entry_id">
          {targets.map((t) => <option key={t.id} value={t.id}>{dateShort(t.date)} · {t.concept} · {money(t.debit, true)}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Field label="Tipo" htmlFor="aj-k">
          <NativeSelect id="aj-k" name="direction">
            <option value="credit">A favor del residente (baja la deuda)</option>
            <option value="debit">A cargo del residente (sube la deuda)</option>
          </NativeSelect>
        </Field>
        <Field label="Monto" htmlFor="aj-a"><Input id="aj-a" name="amount" inputMode="decimal" autoComplete="off" className="num" /></Field>
      </div>
      <Field label="Motivo" htmlFor="aj-t"><Input id="aj-t" name="description" maxLength={200} placeholder="Ej.: se cobró de más la U.T.E." /></Field>
      <FormError>{error}</FormError>
      <Submit pending={m.isPending}>Registrar ajuste</Submit>
    </form>
  )
}

function PersonFields({ prefix }: { prefix: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nombre" htmlFor={`${prefix}-fn`}><Input id={`${prefix}-fn`} name="first_name" maxLength={80} required /></Field>
      <Field label="Apellido" htmlFor={`${prefix}-ln`}><Input id={`${prefix}-ln`} name="last_name" maxLength={80} required /></Field>
      <Field label="Correo (opcional)" htmlFor={`${prefix}-em`}><Input id={`${prefix}-em`} name="email" type="email" maxLength={120} /></Field>
      <Field label="Teléfono (opcional)" htmlFor={`${prefix}-ph`}><Input id={`${prefix}-ph`} name="phone" maxLength={40} /></Field>
    </div>
  )
}

const personOf = (d: FormData): PersonInput => ({
  first_name: String(d.get('first_name') || '').trim(),
  last_name: String(d.get('last_name') || '').trim(),
  email: String(d.get('email') || '').trim(),
  phone: String(d.get('phone') || '').trim(),
})

function OccupantsForms({ o, rented, onDone }: { o: Occupancy; rented: boolean; onDone: () => void }) {
  const { orgId, today } = usePanel()
  const tenant = rented ? (o.role === 'tenant' ? { id: o.id, person: o.person.name } : o.other_occupancies.find((x) => x.role === 'tenant')) : null
  const moveOut = useMoveOut()
  const newTenant = useNewTenant(orgId)
  const sale = useSale(orgId)
  const out = useFormRun(onDone, 'Fin del alquiler registrado')
  const nt = useFormRun(onDone, 'Inquilino registrado')
  const sl = useFormRun(onDone, 'Venta registrada')

  return (
    <div className="grid gap-6">
      {tenant ? (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            out.run(moveOut.mutateAsync({ occId: tenant.id, end_date: String(new FormData(e.currentTarget).get('end_date') || '') }))
          }}
        >
          <h4 className="text-[13px] font-semibold">Fin del alquiler de {tenant.person}</h4>
          <Field label="Último día" htmlFor="mo-d"><Input id="mo-d" name="end_date" type="date" defaultValue={today} max={today} /></Field>
          <FormError>{out.error}</FormError>
          <Submit pending={moveOut.isPending}>Registrar fin del alquiler</Submit>
        </form>
      ) : null}

      <form
        className={cn('grid gap-3', tenant && 'border-t border-line pt-5')}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const d = new FormData(e.currentTarget)
          const person = personOf(d)
          if (!person.first_name || !person.last_name) return nt.setError('Completá nombre y apellido.')
          nt.run(newTenant.mutateAsync({ unitId: o.unit_id, person, start: String(d.get('start_date') || ''), replace: Boolean(tenant) }))
        }}
      >
        <h4 className="text-[13px] font-semibold">{tenant ? 'Cambio de inquilino' : 'Nuevo inquilino'}</h4>
        <PersonFields prefix="nt" />
        <Field label={tenant ? 'Desde (el anterior termina el día antes)' : 'Desde'} htmlFor="nt-d"><Input id="nt-d" name="start_date" type="date" defaultValue={today} max={today} /></Field>
        <FormError>{nt.error}</FormError>
        <Submit pending={newTenant.isPending}>Registrar inquilino</Submit>
      </form>

      <form
        className="grid gap-3 border-t border-line pt-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const d = new FormData(e.currentTarget)
          const person = personOf(d)
          if (!person.first_name || !person.last_name) return sl.setError('Completá nombre y apellido de quien compra.')
          sl.run(sale.mutateAsync({ unitId: o.unit_id, person, date: String(d.get('sale_date') || '') }))
        }}
      >
        <h4 className="text-[13px] font-semibold">Venta de la unidad</h4>
        <PersonFields prefix="sa" />
        <Field label="Fecha de la venta" htmlFor="sa-d"><Input id="sa-d" name="sale_date" type="date" defaultValue={today} max={today} /></Field>
        <FormError>{sl.error}</FormError>
        <Submit pending={sale.isPending}>Registrar venta</Submit>
      </form>
    </div>
  )
}
