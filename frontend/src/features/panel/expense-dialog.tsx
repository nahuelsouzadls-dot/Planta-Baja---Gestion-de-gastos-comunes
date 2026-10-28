import * as React from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FormError, Input } from '@/components/ui/form'
import { money, monthLong, monthTitle } from '@/lib/format'
import type { PortfolioBuilding } from '@/lib/types'
import { cn } from '@/lib/utils'
import { hasTenant, useOverlay } from './bits'
import { useSaveSettlement, type BuildingData } from './data'

/** Monto escrito por la persona: con punto o coma decimal, hasta 2 decimales. */
const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/

function nextMonth(key: string) {
  const [y, m] = key.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** Mes a cargar por defecto: el actual si falta; si no, el borrador abierto o el siguiente al último. */
function defaultMonth(current: string, d: BuildingData) {
  const months = d.settlements.map((s) => s.month).sort()
  if (!months.includes(current)) return current
  const draft = d.settlements.find((s) => s.status !== 'issued')
  if (draft) return draft.month
  return nextMonth(months[months.length - 1])
}

/** El concepto que lleva aclaración (cuota extraordinaria: solo propietario y no es fondo de reserva). */
const detailConcept = (d: BuildingData) => d.concepts.find((c) => c.kind === 'owner_only' && !c.is_reserve_fund)
/** "4200.00" → "4200" en el campo. */
const plain = (amount: string) => String(amount).replace(/\.00$/, '')

export function ExpenseDialog({ building, data: d, month: current }: { building: PortfolioBuilding; data: BuildingData; month: string }) {
  const overlay = useOverlay('gastos')
  const open = Boolean(overlay.value)
  const month = overlay.value && overlay.value !== 'nuevo' ? overlay.value : defaultMonth(current, d)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && overlay.close()}>
      <DialogContent className="max-w-[920px] p-0">
        {open ? <ExpenseForm key={month} building={building} d={d} initialMonth={month} onDone={overlay.close} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ExpenseForm({ building, d, initialMonth, onDone }: { building: PortfolioBuilding; d: BuildingData; initialMonth: string; onDone: () => void }) {
  const save = useSaveSettlement(building.id)
  const [month, setMonth] = React.useState(initialMonth)
  const existing = d.settlements.find((s) => s.month === month)
  const last = d.settlements.slice().sort((x, y) => y.month.localeCompare(x.month))[0]
  const base = existing ?? last
  const extra = detailConcept(d)
  const baseAmounts = Object.fromEntries((base?.items ?? []).map((it) => [it.concept_id, it]))

  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(d.concepts.map((c) => [c.id, baseAmounts[c.id] && (existing || c.id !== extra?.id) ? plain(baseAmounts[c.id].amount) : '0'])),
  )
  const [note, setNote] = React.useState(existing && extra ? baseAmounts[extra.id]?.detail ?? '' : '')
  const [error, setError] = React.useState('')

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4}-\d{2}$/.test(month)) return setError('Elegí el mes de la liquidación.')
    if (existing?.status === 'issued') return setError(`${monthTitle(month)} ya fue emitido y no se puede modificar. Registrá un ajuste.`)
    const items: Record<string, { amount: string; detail?: string }> = {}
    for (const c of d.concepts) {
      const raw = (values[c.id] ?? '').trim().replace(',', '.') || '0'
      if (!AMOUNT_RE.test(raw)) return setError(`${c.name}: ingresá un monto válido (0 o más, hasta 2 decimales).`)
      items[c.id] = { amount: raw }
      if (extra && c.id === extra.id) items[c.id].detail = note.trim().slice(0, 140)
    }
    setError('')
    save.mutate(
      { month, items },
      {
        onSuccess: () => {
          toast.success(`Borrador de ${monthLong(month)} guardado. Emitilo cuando esté listo.`)
          onDone()
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <DialogHeader className="border-b border-line px-6 pt-6 pb-4">
        <DialogTitle>Gastos del mes</DialogTitle>
        <DialogDescription>
          {building.name} · {existing ? 'editando el borrador con los montos guardados.' : 'se precargan los montos del último mes como referencia.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 overflow-y-auto px-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid content-start gap-3.5">
          <Field label="Mes" htmlFor="x-m">
            <Input id="x-m" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            {d.concepts.map((c) => (
              <Field key={c.id} label={c.name} htmlFor={'f-' + c.id}>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
                  <Input
                    id={'f-' + c.id}
                    inputMode="decimal"
                    autoComplete="off"
                    className="num pl-7 text-right"
                    value={values[c.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </Field>
            ))}
          </div>
          {extra ? (
            <Field label={`Detalle de la ${extra.name.toLowerCase()}`} htmlFor="x-n">
              <Input id="x-n" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: pintura de fachada" />
            </Field>
          ) : null}
          <FormError>{error}</FormError>
        </div>
        <Preview d={d} values={values} />
      </div>

      <DialogFooter className="border-t border-line px-6 py-4">
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2Icon className="animate-spin" /> : null}
          Guardar borrador
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Vista previa del reparto. Es solo visual: no se envía; el backend calcula los cargos al emitir. */
function Preview({ d, values }: { d: BuildingData; values: Record<string, string> }) {
  const value = (id: string) => Math.max(Number(String(values[id] ?? '0').replace(',', '.')) || 0, 0)
  const ordinary = d.concepts.filter((c) => c.kind === 'ordinary').reduce((s, c) => s + value(c.id), 0)
  const ownerOnly = d.concepts.filter((c) => c.kind !== 'ordinary').reduce((s, c) => s + value(c.id), 0)
  const units = d.units.slice().sort((x, y) => x.number.localeCompare(y.number, 'es', { numeric: true }))
  let tTenant = 0
  let tOwner = 0
  const rows = units.map((u) => {
    const coef = Number(u.coefficient)
    const rented = hasTenant(d.accounts, u.number)
    const tenant = rented ? ordinary * coef : 0
    const owner = ownerOnly * coef + (rented ? 0 : ordinary * coef)
    tTenant += tenant
    tOwner += owner
    return { n: u.number, rented, tenant, owner }
  })
  const total = ordinary + ownerOnly
  const diff = Math.round(total - tTenant - tOwner)

  return (
    <div className="min-w-0 rounded-lg border border-border">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-bold">Prorrateo por coeficiente</h3>
        <p className="text-xs text-muted-foreground">Estimado. El reparto exacto (con redondeo) lo hace el sistema al emitir.</p>
      </div>
      <div className="max-h-[360px] overflow-y-auto px-2">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-card">
            <tr className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th className="px-2 py-2 text-left font-semibold">Unidad</th>
              <th className="px-2 py-2 text-right font-semibold">Inquilino</th>
              <th className="px-2 py-2 text-right font-semibold">Propietario</th>
              <th className="px-2 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className="border-t border-line">
                <td className="num px-2 py-1.5">{r.n}</td>
                <td className="num px-2 py-1.5 text-right text-muted-foreground">{r.rented ? money(r.tenant) : '—'}</td>
                <td className="num px-2 py-1.5 text-right">{money(r.owner)}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{money(r.tenant + r.owner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between border-t border-line px-4 py-3 text-[13px] font-semibold">
        <span>Total distribuido</span>
        <span className="num">{money(tTenant + tOwner)}</span>
      </div>
      <p className={cn('px-4 pb-3 text-xs', Math.abs(diff) <= 1 ? 'text-muted-foreground' : 'font-medium text-bad')}>
        {Math.abs(diff) <= 1 ? `Coincide con el total cargado (${money(total)}).` : `Diferencia de ${money(diff)} contra el total: revisá los coeficientes.`}
      </p>
    </div>
  )
}
