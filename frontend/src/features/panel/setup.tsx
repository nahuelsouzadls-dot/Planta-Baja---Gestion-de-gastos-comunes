import * as React from 'react'
import { useNavigate } from 'react-router'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FormError, Input } from '@/components/ui/form'
import { amountText, percent } from '@/lib/format'
import type { Portfolio } from '@/lib/types'
import { useOverlay } from './bits'
import { useBuilding, useNewBuilding, useNewUnit, usePanel } from './data'

/**
 * Altas de la cartera, en la URL como ?alta=edificio o ?alta=unidad:<edificio>.
 * El flujo encadena: al crear un edificio se abre directo el alta de su primera unidad,
 * y cada unidad ofrece "Guardar y agregar otra" hasta completar el 100 % de coeficientes.
 */
export function SetupDialogs({ portfolio }: { portfolio: Portfolio }) {
  const alta = useOverlay('alta')
  const [kind, buildingId] = (alta.value ?? '').split(':')
  const building = portfolio.buildings.find((b) => b.id === buildingId)
  return (
    <>
      <Dialog open={kind === 'edificio'} onOpenChange={(o) => !o && alta.close()}>
        <DialogContent className="max-w-xl">{kind === 'edificio' ? <BuildingForm /> : null}</DialogContent>
      </Dialog>
      <Dialog open={kind === 'unidad' && Boolean(building)} onOpenChange={(o) => !o && alta.close()}>
        <DialogContent className="max-w-xl">{kind === 'unidad' && building ? <UnitForm key={alta.value} buildingId={building.id} name={building.name} /> : null}</DialogContent>
      </Dialog>
    </>
  )
}

const text = (d: FormData, k: string) => String(d.get(k) || '').trim()

function BuildingForm() {
  const { orgId } = usePanel()
  const navigate = useNavigate()
  const m = useNewBuilding(orgId)
  const [error, setError] = React.useState('')
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const d = new FormData(e.currentTarget)
        const name = text(d, 'name')
        const address = text(d, 'address')
        const due = Number(text(d, 'due_day') || '10')
        if (!name || !address) return setError('Completá el nombre y la dirección.')
        if (!Number.isInteger(due) || due < 1 || due > 28) return setError('El día de vencimiento va del 1 al 28.')
        setError('')
        m.mutateAsync({ name, address, neighborhood: text(d, 'neighborhood'), due_day: due, bank_name: text(d, 'bank_name'), bank_account: text(d, 'bank_account'), bank_holder: text(d, 'bank_holder') }).then(
          (b) => {
            toast.success(`Edificio ${b.name} creado. Ahora agregá sus unidades.`)
            navigate(`/panel/edificio/${b.id}?alta=unidad:${b.id}`)
          },
          (err: Error) => setError(err.message),
        )
      }}
    >
      <DialogHeader>
        <DialogTitle>Nuevo edificio</DialogTitle>
        <DialogDescription>Después cargás las unidades con su propietario y coeficiente.</DialogDescription>
      </DialogHeader>
      <Field label="Nombre" htmlFor="nb-n"><Input id="nb-n" name="name" maxLength={200} placeholder="Ej.: Edificio Rambla 2140" autoFocus /></Field>
      <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
        <Field label="Dirección" htmlFor="nb-a"><Input id="nb-a" name="address" maxLength={300} placeholder="Calle y número" /></Field>
        <Field label="Barrio (opcional)" htmlFor="nb-b"><Input id="nb-b" name="neighborhood" maxLength={100} /></Field>
      </div>
      <Field label="Día de vencimiento" htmlFor="nb-d" hint="Del 1 al 28 de cada mes.">
        <Input id="nb-d" name="due_day" inputMode="numeric" defaultValue="10" className="num w-24" />
      </Field>
      <fieldset className="grid gap-3 rounded-2xl bg-muted/60 p-4">
        <legend className="sr-only">Cuenta para transferencias</legend>
        <p className="text-xs font-semibold text-ink-2">Cuenta para transferencias <span className="font-normal text-muted-foreground">(opcional, sale en la liquidación)</span></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Banco" htmlFor="nb-bn"><Input id="nb-bn" name="bank_name" maxLength={100} placeholder="Ej.: Scotiabank" /></Field>
          <Field label="Número de cuenta" htmlFor="nb-ba"><Input id="nb-ba" name="bank_account" maxLength={50} className="num" /></Field>
        </div>
        <Field label="Titular" htmlFor="nb-bh"><Input id="nb-bh" name="bank_holder" maxLength={200} /></Field>
      </fieldset>
      <FormError>{error}</FormError>
      <DialogFooter>
        <Button type="submit" disabled={m.isPending}>
          {m.isPending ? <Loader2Icon className="animate-spin" /> : null}
          Crear y agregar unidades
        </Button>
      </DialogFooter>
    </form>
  )
}

/** "8,3333" (%) → "0.083333" para la API. Corre la coma dos lugares sobre el texto; nunca pasa por Number. */
function coefficientText(raw: string): string | null {
  const s = raw.trim().replace('%', '').trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s) || !/[1-9]/.test(s)) return null
  const [int, frac = ''] = s.split('.')
  const padded = int.padStart(3, '0')
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '')
  const out = `${whole}.${padded.slice(-2)}${frac}`.replace(/0+$/, '').replace(/\.$/, '')
  return out === '1' || out.startsWith('0.') ? out : null
}

function UnitForm({ buildingId, name }: { buildingId: string; name: string }) {
  const { orgId, today } = usePanel()
  const alta = useOverlay('alta')
  const b = useBuilding(buildingId)
  const m = useNewUnit(orgId)
  const [error, setError] = React.useState('')
  const again = React.useRef(false)
  const assigned = b.data?.summary.funds.coefficient_sum

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const d = new FormData(form)
        const number = text(d, 'number')
        const floor = Number(text(d, 'floor'))
        const coefficient = coefficientText(text(d, 'coefficient'))
        const rawOpening = text(d, 'opening')
        const opening = rawOpening ? amountText(rawOpening) : null
        const owner = { first_name: text(d, 'first_name'), last_name: text(d, 'last_name'), email: text(d, 'email'), phone: text(d, 'phone') }
        if (!number) return setError('Escribí el número de la unidad.')
        if (text(d, 'floor') === '' || !Number.isInteger(floor)) return setError('El piso es un número entero (0 para planta baja).')
        if (!coefficient) return setError('El coeficiente va en porcentaje, mayor a 0 y hasta 100, con hasta 4 decimales (ej.: 8,3333).')
        if (!owner.first_name || !owner.last_name) return setError('Completá nombre y apellido del propietario.')
        if (rawOpening && !opening) return setError('La deuda inicial es un monto positivo, por ejemplo 4153,80.')
        setError('')
        m.mutateAsync({ buildingId, unit: { number, floor, coefficient, receives_paper: d.get('paper') === 'on' }, owner, start: text(d, 'start') || today, opening }).then(
          () => {
            toast.success(`Unidad ${number} agregada en ${name}`)
            if (again.current) {
              form.reset()
              form.querySelector<HTMLInputElement>('#nu-n')?.focus()
            } else alta.close()
          },
          (err: Error) => setError(err.message),
        )
      }}
    >
      <DialogHeader>
        <DialogTitle>Agregar unidad</DialogTitle>
        <DialogDescription>
          {name}
          {assigned ? <> · coeficientes asignados: <b className={Number(assigned) === 1 ? 'text-ok' : 'text-brand'}>{percent(assigned)}</b></> : null}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Número" htmlFor="nu-n"><Input id="nu-n" name="number" maxLength={10} placeholder="Ej.: 101" autoFocus /></Field>
        <Field label="Piso" htmlFor="nu-f"><Input id="nu-f" name="floor" inputMode="numeric" className="num" placeholder="1" /></Field>
        <Field label="Coeficiente (%)" htmlFor="nu-c"><Input id="nu-c" name="coefficient" inputMode="decimal" className="num" placeholder="8,3333" /></Field>
      </div>
      <fieldset className="grid gap-3 rounded-2xl bg-muted/60 p-4">
        <legend className="sr-only">Propietario</legend>
        <p className="text-xs font-semibold text-ink-2">Propietario <span className="font-normal text-muted-foreground">(el inquilino se agrega después desde la ficha)</span></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="nu-fn"><Input id="nu-fn" name="first_name" maxLength={80} /></Field>
          <Field label="Apellido" htmlFor="nu-ln"><Input id="nu-ln" name="last_name" maxLength={80} /></Field>
          <Field label="Correo (opcional)" htmlFor="nu-em"><Input id="nu-em" name="email" type="email" maxLength={120} /></Field>
          <Field label="Teléfono (opcional)" htmlFor="nu-ph"><Input id="nu-ph" name="phone" maxLength={40} /></Field>
        </div>
      </fieldset>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field label="Desde" htmlFor="nu-s"><Input id="nu-s" name="start" type="date" defaultValue={today} max={today} /></Field>
        <Field label="Deuda inicial (opcional)" htmlFor="nu-o" hint="Saldo a la fecha de corte; queda como asiento de apertura.">
          <Input id="nu-o" name="opening" inputMode="decimal" className="num" placeholder="0,00" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="paper" className="size-4 accent-[var(--brand)]" />
        Recibe la liquidación en papel
      </label>
      <FormError>{error}</FormError>
      <DialogFooter className="gap-2">
        <Button type="submit" variant="outline" disabled={m.isPending} onClick={() => (again.current = true)}>Guardar y agregar otra</Button>
        <Button type="submit" disabled={m.isPending} onClick={() => (again.current = false)}>
          {m.isPending ? <Loader2Icon className="animate-spin" /> : null}
          Guardar unidad
        </Button>
      </DialogFooter>
    </form>
  )
}
