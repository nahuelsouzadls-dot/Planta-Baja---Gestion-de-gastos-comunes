import * as React from 'react'
import { CheckIcon, ExternalLinkIcon, FileTextIcon, Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/form'
import { Checkbox, Skeleton } from '@/components/ui/misc'
import { Pill, ROLE_LABEL } from '@/components/shared'
import { date, money, monthLong } from '@/lib/format'
import type { Occupancy } from '@/lib/types'
import { useOverlay } from './bits'
import { useApproveReceipt, useOccupancy, usePanel, useReceipt, useReceiptFile, useRejectReceipt } from './data'

export function owedText(o: Pick<Occupancy, 'overdue_months' | 'balance'>) {
  if (o.overdue_months.length) return 'Vencido: ' + o.overdue_months.map(monthLong).join(', ')
  return Number(o.balance) > 0 ? 'Pendiente del mes en curso' : 'Sin deuda'
}

const CHECKS = ['El monto coincide con el saldo a cubrir', 'La cuenta de destino es la de la administración', 'La referencia aparece en el extracto bancario']

export function ReceiptDialog() {
  const overlay = useOverlay('comprobante')
  return (
    <Dialog open={Boolean(overlay.value)} onOpenChange={(o) => !o && overlay.close()}>
      <DialogContent className="max-w-[880px]">
        {overlay.value ? <ReceiptBody key={overlay.value} id={overlay.value} onDone={overlay.close} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ReceiptBody({ id, onDone }: { id: string; onDone: () => void }) {
  const { orgs, orgId } = usePanel()
  const company = orgs.find((o) => o.id === orgId)?.name ?? ''
  const r = useReceipt(id)
  const file = useReceiptFile(id)
  const occ = useOccupancy(r.data?.allocations[0]?.occupancy ?? null)
  const approve = useApproveReceipt()
  const reject = useRejectReceipt()
  const [checks, setChecks] = React.useState<boolean[]>(CHECKS.map(() => false))
  const [reason, setReason] = React.useState('')
  const [reasonError, setReasonError] = React.useState('')
  const reasonRef = React.useRef<HTMLInputElement>(null)

  if (r.error) return <p className="text-[13px] text-bad">{r.error.message}</p>
  if (!r.data || !occ.data)
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Cargando comprobante">
        <DialogTitle className="sr-only">Revisar comprobante</DialogTitle>
        <Skeleton className="h-7 w-72" />
        <div className="grid gap-6 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </div>
    )

  const rc = r.data
  const o = occ.data
  const pending = rc.status === 'pending'
  const busy = approve.isPending || reject.isPending

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Comprobante de {rc.person}</DialogTitle>
        <DialogDescription>
          {rc.building}, apto {rc.unit} · {ROLE_LABEL[rc.role]} · transferido el {date(rc.transfer_date)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          {file.isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : file.data?.content_type.startsWith('image/') ? (
            <a href={file.data.url} target="_blank" rel="noopener" title="Abrir en tamaño completo" className="group relative block overflow-hidden rounded-lg border border-border bg-muted">
              <img src={file.data.url} alt="Comprobante subido" className="max-h-[42vh] w-full object-contain" />
              <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-card/90 px-2 py-1 text-[11.5px] font-medium opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                <ExternalLinkIcon className="size-3" />Tamaño completo
              </span>
            </a>
          ) : file.data ? (
            <Button asChild variant="outline" className="justify-start">
              <a href={file.data.url} target="_blank" rel="noopener"><FileTextIcon />Abrir el PDF del comprobante</a>
            </Button>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">El archivo no está en el almacenamiento.</p>
          )}

          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <span>Datos declarados</span>
              <span>Transferencia</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Monto transferido</p>
            <p className="num text-[26px] font-semibold tracking-tight">{money(rc.declared_amount, true)}</p>
            <dl className="mt-3 grid gap-1.5 text-[13px]">
              {[['Fecha', date(rc.transfer_date)], ['Origen', rc.person], ['Destino', company], ['Nota', rc.note || '—']].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            {rc.allocations.length > 1 ? (
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted-foreground">
                Reparto: {rc.allocations.map((a) => `apto ${a.unit} (${ROLE_LABEL[a.role]}) ${money(a.amount, true)}`).join(' · ')}
              </p>
            ) : null}
          </div>
          {file.data?.content_type.startsWith('image/') ? <p className="text-[11.5px] text-muted-foreground">El enlace al archivo vence en 5 minutos.</p> : null}
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-border p-4">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Debe cubrir</p>
            <p className="num mt-1 text-[26px] font-semibold tracking-tight">{money(o.balance, true)}</p>
            <p className="text-xs text-muted-foreground">{owedText(o)}</p>
            {Number(rc.declared_amount) !== Number(o.balance) && rc.allocations.length === 1 ? (
              <p className="mt-2 text-xs font-medium text-warn">El monto declarado no coincide con el saldo.</p>
            ) : null}
          </div>

          {pending ? (
            <>
              <fieldset className="grid gap-2.5">
                <legend className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Antes de aprobar</legend>
                {CHECKS.map((c, i) => (
                  <label key={c} className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                    <Checkbox checked={checks[i]} onCheckedChange={(v) => setChecks((cs) => cs.map((x, j) => (j === i ? v === true : x)))} className="mt-px" />
                    <span>{c}</span>
                  </label>
                ))}
              </fieldset>
              <Field label="Motivo, si lo rechazás (lo ve el residente)" htmlFor="rv-reason" error={reasonError}>
                <Input
                  ref={reasonRef}
                  id="rv-reason"
                  maxLength={200}
                  value={reason}
                  aria-invalid={Boolean(reasonError)}
                  onChange={(e) => { setReason(e.target.value); setReasonError('') }}
                  placeholder="Ej.: el monto no coincide con la transferencia"
                />
              </Field>
              <div className="mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (!reason.trim()) {
                      setReasonError('Escribí el motivo: el residente lo ve en su portal.')
                      reasonRef.current?.focus()
                      return
                    }
                    reject.mutate(
                      { id: rc.id, reason: reason.trim() },
                      { onSuccess: () => { toast(`Comprobante rechazado. Se avisa a ${rc.person} (apto ${rc.unit}).`); onDone() }, onError: (e) => toast.error(e.message) },
                    )
                  }}
                >
                  {reject.isPending ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                  Rechazar
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    approve.mutate(rc.id, {
                      onSuccess: () => { toast.success(`Pago validado: ${rc.person}, apto ${rc.unit} (${rc.building})`); onDone() },
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  {approve.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                  Aprobar comprobante
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-auto">
              {rc.status === 'approved' ? <Pill tone="ok">Aprobado</Pill> : <Pill tone="bad">Rechazado</Pill>}
              {rc.reason ? <p className="mt-2 text-[13px] text-muted-foreground">Motivo: {rc.reason}</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
