import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, CopyIcon, Loader2Icon, PaperclipIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FormError, Input } from '@/components/ui/form'
import { PbMark, Pill } from '@/components/shared'
import { api } from '@/lib/api'
import { amountText, comma, dateShort, fileLabel, money, monthLong, monthWord } from '@/lib/format'
import type { PortalAccount } from '@/lib/types'
import { localToday } from '@/lib/utils'
import { checkReceiptFile, useSubmitReceipt, type PortalOccupancy } from './data'

function copyFor(a: PortalAccount, currentMonth: string): [string, string, string] {
  const unpaid = a.unpaid_months
  switch (a.status) {
    case 'pagado':
      return ['Estás al día', money(0), 'No tenés pagos pendientes. Gracias.']
    case 'revision':
      return ['Recibimos tu comprobante', money(a.balance, true), 'La administración lo está verificando con el banco. Te avisamos cuando quede registrado.']
    case 'moroso':
      return [
        `Tenés ${unpaid.length} ${unpaid.length === 1 ? 'mes' : 'meses'} sin pagar`,
        money(a.balance, true),
        'Adeudás ' + unpaid.map(monthLong).join(', ') + '. Si ya pagaste, subí el comprobante.',
      ]
    case 'sin-cargar':
      return ['Todavía no hay liquidación', money(a.balance, true), `La administración aún no publicó la liquidación de ${monthLong(currentMonth)}.`]
    default:
      return ['Tenés para pagar', money(a.balance, true), `Liquidación de ${monthLong(currentMonth)}. Vencimiento: ${a.due_day} de ${monthWord(currentMonth)}.`]
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[11.5px] text-muted-foreground">{label}</p>
        <p className="truncate text-[14px] font-medium">{value}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Copiar ${label.toLowerCase()}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => undefined)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <CheckIcon className="text-ok" /> : <CopyIcon />}
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  )
}

export function PaymentCard({ account, currentMonth, occupancies }: { account: PortalAccount; currentMonth: string; occupancies: PortalOccupancy[] }) {
  const a = account
  const [label, amount, sub] = copyFor(a, currentMonth)
  const canPay = Number(a.balance) > 0 && a.status !== 'revision'
  const paid = a.status === 'pagado'
  const moroso = a.status === 'moroso'
  const bank = (
    [
      ['Banco', a.bank.bank_name],
      ['Cuenta corriente (pesos)', a.bank.account],
      ['Titular', a.bank.holder],
      ['Concepto', a.bank.concept],
    ] as const
  ).filter(([, v]) => v)

  const fileRef = React.useRef<HTMLInputElement>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState('')

  return (
    <section aria-live="polite" className="@container grid gap-3">
      {paid ? (
        <div className="relative isolate flex flex-col items-center overflow-hidden rounded-2xl border border-ok/25 bg-ok-bg px-6 py-10 text-center">
          <PbMark aria-hidden className="pointer-events-none absolute -right-6 -bottom-8 h-40 w-auto opacity-[0.08]" />
          <span className="relative grid size-[72px] place-items-center rounded-full bg-ok text-white shadow-[0_10px_30px_rgb(26_158_82/0.4)]">
            <CheckIcon className="size-10" strokeWidth={3} />
          </span>
          <p className="relative mt-4 font-display text-[26px] font-bold text-ok">¡Estás al día!</p>
          <p className="relative mt-1 max-w-[34ch] text-[14px] text-muted-foreground">No tenés ningún saldo pendiente con la administración. ¡Gracias!</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgb(16_24_40/0.05)]">
            <div className={`relative isolate flex flex-col justify-center overflow-hidden px-6 py-7 sm:px-7 ${moroso ? 'bg-bad text-white' : 'bg-[#53B2EC] text-[#0F2A3F]'}`}>
              <PbMark aria-hidden className="pointer-events-none absolute -right-5 -bottom-7 h-40 w-auto opacity-[0.16] [filter:brightness(0)_invert(1)]" />
              <p className={`relative text-[13px] font-semibold ${moroso ? 'text-white/85' : 'text-[#0F2A3F]/75'}`}>{label}</p>
              <p className="num relative mt-1.5 text-[38px] leading-none font-semibold tracking-tight whitespace-nowrap @[420px]:text-[44px]">{amount}</p>
              <p className={`relative mt-3 max-w-[44ch] text-[13px] leading-relaxed ${moroso ? 'text-white/85' : 'text-[#0F2A3F]/75'}`}>{sub}</p>
            </div>
            {a.status === 'revision' && a.pending_receipt ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3.5 text-[13px] sm:px-7">
                <Pill tone="warn">En revisión</Pill>
                <span className="text-muted-foreground">
                  {fileLabel(a.pending_receipt.file)} · transferido el {dateShort(a.pending_receipt.date)}
                </span>
              </div>
            ) : null}
          </div>

          {canPay ? (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-amber)] text-[14px] font-semibold text-[#111827] shadow-[0_1px_2px_rgb(16_24_40/0.08)] transition-colors hover:bg-[color-mix(in_srgb,var(--brand-amber)_90%,#000)] focus-visible:ring-[3px] focus-visible:ring-acc-soft2 focus-visible:outline-none active:translate-y-px [&_svg]:size-4"
              >
                <UploadIcon />
                Subir comprobante
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const problem = checkReceiptFile(f)
                  setFileError(problem ?? '')
                  if (!problem) setFile(f)
                }}
              />
              <p className="-mt-1 text-center text-xs text-muted-foreground">Después de transferir, subí la foto o el PDF del banco. Lo revisamos en el día.</p>
              {fileError ? <FormError>{fileError}</FormError> : null}

              <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_rgb(16_24_40/0.05)]">
                <p className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Datos para transferir</p>
                {bank.map(([l, v]) => (
                  <CopyRow key={l} label={l} value={v} />
                ))}
              </div>
              <UploadDialog file={file} onClose={() => setFile(null)} account={a} occupancies={occupancies} />
            </>
          ) : null}
        </>
      )}
    </section>
  )
}

interface SplitAccount {
  id: string
  unit: string
  building: string
  balance: string
}

/** Confirmación antes de enviar: monto, fecha y, si debe en varias unidades, el reparto (N12). */
function UploadDialog({ file, onClose, account, occupancies }: { file: File | null; onClose: () => void; account: PortalAccount; occupancies: PortalOccupancy[] }) {
  const qc = useQueryClient()
  const submit = useSubmitReceipt(account.id)
  const [accounts, setAccounts] = React.useState<SplitAccount[]>([])
  const [error, setError] = React.useState('')
  const today = localToday()

  // Otras unidades de la misma persona con saldo: el pago se puede repartir entre ellas.
  React.useEffect(() => {
    if (!file) return
    setError('')
    const current = occupancies.find((o) => o.id === account.id)
    const siblings = occupancies.filter((o) => o.id !== account.id && o.person_id === current?.person_id)
    Promise.all(
      siblings.map((o) =>
        qc.fetchQuery({ queryKey: ['portal', o.id, 'account'], queryFn: () => api.get<PortalAccount>(`portal/occupancies/${o.id}/account`) }).catch(() => null),
      ),
    ).then((others) => {
      const list = [account, ...others.filter((x): x is PortalAccount => Boolean(x && Number(x.balance) > 0 && x.status !== 'revision'))]
      setAccounts(list.map((x) => ({ id: x.id, unit: x.unit, building: x.building, balance: x.balance })))
    })
  }, [file, account, occupancies, qc])

  const split = accounts.length > 1

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    const data = new FormData(e.currentTarget)
    const amount = amountText(String(data.get('amount') || ''))
    const date = String(data.get('date') || '')
    if (!amount) return setError('Escribí el monto que transferiste (por ejemplo 4153,80).')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Elegí la fecha de la transferencia.')
    let allocations: { occupancy_id: string; amount: string }[] | undefined
    if (split) {
      const raw = accounts.map((x) => [x.id, String(data.get('alloc:' + x.id) || '').trim()] as const).filter(([, v]) => v && v !== '0')
      allocations = raw.map(([id, v]) => ({ occupancy_id: id, amount: amountText(v) ?? '' }))
      if (!allocations.length || allocations.some((x) => !x.amount)) return setError('Revisá los montos de cada unidad.')
    }
    setError('')
    try {
      await submit.mutateAsync({ file, amount, date, allocations, note: String(data.get('note') || '').trim() })
      toast.success('Comprobante enviado. Te avisamos cuando esté validado.')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && !submit.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar comprobante</DialogTitle>
          <DialogDescription>Confirmá los datos de la transferencia. La administración los compara con el banco.</DialogDescription>
        </DialogHeader>
        {file ? (
          <form key={file.name + file.size} className="grid gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[13px]">
              <PaperclipIcon className="size-4 text-muted-foreground" />
              <span className="min-w-0 truncate font-medium">{file.name}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monto que transferiste" htmlFor="u-amount">
                <Input id="u-amount" name="amount" inputMode="decimal" autoComplete="off" className="num" defaultValue={split ? '' : comma(account.balance)} />
              </Field>
              <Field label="Fecha de la transferencia" htmlFor="u-date">
                <Input id="u-date" name="date" type="date" max={today} defaultValue={today} />
              </Field>
            </div>
            {split ? (
              <div className="grid gap-3 rounded-lg border border-border p-3">
                <p className="text-[13px] text-muted-foreground">Tenés saldo en más de una unidad. Indicá cuánto va a cada una:</p>
                {accounts.map((x) => (
                  <Field key={x.id} label={`Apto ${x.unit} · ${x.building} (debe ${money(x.balance, true)})`} htmlFor={'u-' + x.id}>
                    <Input id={'u-' + x.id} name={'alloc:' + x.id} inputMode="decimal" autoComplete="off" className="num" defaultValue={comma(x.balance)} />
                  </Field>
                ))}
                <Field label="Aclaración (opcional)" htmlFor="u-note">
                  <Input id="u-note" name="note" maxLength={200} placeholder="Ej.: pago de las dos unidades de octubre" />
                </Field>
              </div>
            ) : null}
            <FormError>{error}</FormError>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={submit.isPending}>
                Cancelar
              </Button>
              <Button type="submit" variant="theme" disabled={submit.isPending}>
                {submit.isPending ? <Loader2Icon className="animate-spin" /> : null}
                {submit.isPending ? 'Enviando…' : 'Enviar comprobante'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
