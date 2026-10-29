import * as React from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router'
import { BellIcon, FileTextIcon, HomeIcon, LogOutIcon, MessageSquareIcon, ReceiptIcon } from 'lucide-react'

import { NativeSelect } from '@/components/ui/form'
import { Count, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@/components/ui/misc'
import { ErrorState, PbMark, ROLE_LABEL, SchemeSwitch, useDocumentTitle } from '@/components/shared'
import { api } from '@/lib/api'
import { date, initials, money } from '@/lib/format'
import type { Me, PortalAccount } from '@/lib/types'
import { cn, localToday, storage } from '@/lib/utils'
import { occupanciesOf, useAccount, useClaims, useNotices, type PortalOccupancy } from './data'
import { PaymentCard } from './payment-card'
import { AvisosTab, ComprobantesTab, LiquidacionTab, ReclamosTab } from './tabs'

const OCC_KEY = 'gc-occupancy'

type SimState = 'pagado' | 'pendiente' | 'moroso' | 'revision' | null

const prevMonth = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Simulador de estado (solo dev): devuelve la cuenta con el estado forzado, sin tocar el backend. */
function applySim(a: PortalAccount | undefined, sim: SimState, currentMonth: string): PortalAccount | undefined {
  if (!a || !sim) return a
  if (sim === 'pagado') return { ...a, status: 'pagado', balance: '0.00', overdue_months: [], unpaid_months: [], pending_receipt: null }
  if (sim === 'revision') return { ...a, status: 'revision' }
  if (sim === 'moroso') {
    const prev = prevMonth(currentMonth)
    const balance = Number(a.balance) > 0 ? a.balance : '8307.60'
    return { ...a, status: 'moroso', balance, pending_receipt: null, overdue_months: a.overdue_months.length ? a.overdue_months : [prev], unpaid_months: a.unpaid_months.length ? a.unpaid_months : [prev, currentMonth] }
  }
  const balance = Number(a.balance) > 0 ? a.balance : '4153.80'
  return { ...a, status: 'pendiente', balance, pending_receipt: null, unpaid_months: a.unpaid_months.length ? a.unpaid_months : [currentMonth] }
}

export default function PortalApp({ me }: { me: Me }) {
  const occupancies = React.useMemo(() => occupanciesOf(me), [me])
  const navigate = useNavigate()
  const [occId, setOccId] = React.useState(() => {
    const saved = storage.get(OCC_KEY)
    return (occupancies.find((o) => o.id === saved) ?? occupancies[0]).id
  })

  const today = localToday()
  const currentMonth = today.slice(0, 7)
  const account = useAccount(occId)
  const notices = useNotices(occId)
  const claims = useClaims(occId)
  const real = account.data
  // Simulador de estado solo para desarrollo (ver cada vista sin subir comprobante).
  const [sim, setSim] = React.useState<SimState>(null)
  const a = applySim(real, sim, currentMonth)
  useDocumentTitle(a ? `Mi cuenta · ${a.building}` : 'Mi cuenta')

  const openClaims = (claims.data ?? []).filter((c) => c.status !== 'resolved').length
  // Igual que la etiqueta "Nuevo" de la sección: avisos de los últimos 7 días.
  const newNotices = (notices.data ?? []).filter((n) => (Date.parse(today) - Date.parse(n.date)) / 86_400_000 <= 7).length
  const counts = { avisos: newNotices, reclamos: openClaims }

  const userName = [me.first_name, me.last_name].filter(Boolean).join(' ')

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0F2A3F]"><PbMark className="h-[22px] w-[25px]" /></span>
            <div className="min-w-0 leading-tight">
              {a ? (
                <>
                  <p className="truncate font-display text-[15px] font-bold">{a.building}</p>
                  <p className="truncate text-xs text-muted-foreground">Administra {a.organization}</p>
                </>
              ) : (
                <div className="grid gap-1.5"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-24" /></div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-muted-foreground sm:block">{date(today)}</span>
            <SchemeSwitch />
            <AccountMenu name={userName || 'Mi cuenta'} email={me.email} org={a?.organization} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[760px] px-4 pb-28 sm:px-6 lg:pb-16">
        {occupancies.length > 1 ? (
          <div className="mt-2 mb-5 max-w-sm">
            <label htmlFor="occ" className="sr-only">Unidad</label>
            <NativeSelect
              id="occ"
              value={occId}
              onChange={(e) => {
                storage.set(OCC_KEY, e.target.value)
                setOccId(e.target.value)
                navigate('/portal')
              }}
            >
              {occupancies.map((o) => (
                <option key={o.id} value={o.id}>
                  Apto {o.unit_number} · {o.building_name} · {ROLE_LABEL[o.role]}
                  {o.end_date ? ' (cerrada)' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {account.error ? (
          <ErrorState message={account.error.message} onRetry={() => account.refetch()} />
        ) : !a ? (
          <div className="grid gap-4 pt-2" aria-busy="true" aria-label="Cargando tu cuenta">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            {/* Escritorio: navegación arriba. Celular: barra inferior fija (abajo). */}
            <div className="mt-1 hidden lg:block"><PortalNav variant="top" counts={counts} /></div>
            <div key={occId}>
              <Routes>
                <Route index element={<HomePage a={a} currentMonth={currentMonth} occupancies={occupancies} sim={sim} onSim={setSim} />} />
                <Route path="liquidacion" element={<CardPage><LiquidacionTab account={a} currentMonth={currentMonth} /></CardPage>} />
                <Route
                  path="comprobantes"
                  element={
                    <CardPage title="Mis comprobantes">
                      <ComprobantesTab account={a} onUploadAgain={() => { navigate('/portal'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
                    </CardPage>
                  }
                />
                <Route path="avisos" element={<CardPage title="Avisos"><AvisosTab account={a} today={today} /></CardPage>} />
                <Route path="reclamos" element={<CardPage title="Problemas y reclamos"><ReclamosTab account={a} /></CardPage>} />
                <Route path="*" element={<HomePage a={a} currentMonth={currentMonth} occupancies={occupancies} sim={sim} onSim={setSim} />} />
              </Routes>
            </div>
          </>
        )}
      </div>

      <PortalNav variant="bottom" counts={counts} />
    </div>
  )
}

/** Inicio: saludo + tarjeta de pago (con datos para transferir) + pie de dudas. */
function HomePage({
  a, currentMonth, occupancies, sim, onSim,
}: {
  a: PortalAccount
  currentMonth: string
  occupancies: PortalOccupancy[]
  sim: SimState
  onSim: (s: SimState) => void
}) {
  return (
    <div className="grid animate-enter gap-5">
      {import.meta.env.DEV ? <DevSim sim={sim} onSim={onSim} /> : null}
      <section>
        <span className="mb-3 block h-1 w-10 rounded-full bg-[var(--brand-amber)]" aria-hidden="true" />
        <h1 className="font-display text-[30px] leading-[1.1] font-bold">
          Hola, {a.first_name}
          {a.status === 'pagado' ? <>, estás <span className="text-brand">al día</span></> : null}
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Apartamento {a.unit} · {ROLE_LABEL[a.role]}
          {a.role_note ? ` · ${a.role_note}` : ''}
        </p>
        {a.closed ? (
          <p role="note" className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-[13px] text-warn">
            Esta unidad ya no está a tu nombre.{' '}
            {Number(a.balance) > 0 ? `Te queda por pagar ${money(a.balance, true)}.` : 'No tenés saldo pendiente.'}
          </p>
        ) : null}
      </section>
      <PaymentCard account={a} currentMonth={currentMonth} occupancies={occupancies} />
      <p className="text-center text-xs text-muted-foreground">
        ¿Dudas? Escribile a {a.organization.replace(/\.$/, '')}. También podés pedir la liquidación en papel.
      </p>
    </div>
  )
}

/** Contenedor de cada sección (no-inicio): título opcional + tarjeta. */
function CardPage({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="animate-enter">
      {title ? <h1 className="mb-4 font-display text-[22px] font-bold">{title}</h1> : null}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_24_40/0.05)] sm:p-6">{children}</div>
    </section>
  )
}

const NAV_ITEMS = [
  { to: '/portal', end: true, label: 'Inicio', short: 'Inicio', Icon: HomeIcon, key: '' },
  { to: '/portal/liquidacion', end: false, label: 'Liquidación', short: 'Liquid.', Icon: FileTextIcon, key: '' },
  { to: '/portal/comprobantes', end: false, label: 'Comprobantes', short: 'Comprob.', Icon: ReceiptIcon, key: '' },
  { to: '/portal/avisos', end: false, label: 'Avisos', short: 'Avisos', Icon: BellIcon, key: 'avisos' },
  { to: '/portal/reclamos', end: false, label: 'Reclamos', short: 'Reclamos', Icon: MessageSquareIcon, key: 'reclamos' },
] as const

/** Navegación entre secciones: barra inferior en celular, fila superior en escritorio. */
function PortalNav({ variant, counts }: { variant: 'top' | 'bottom'; counts: { avisos: number; reclamos: number } }) {
  const countOf = (k: string) => (k === 'avisos' ? counts.avisos : k === 'reclamos' ? counts.reclamos : 0)

  if (variant === 'bottom') {
    return (
      <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-[760px] items-stretch justify-around px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map(({ to, end, short, Icon, key }) => {
            const count = countOf(key)
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-1 rounded-lg py-1 text-[10px] font-medium transition-colors', isActive ? 'text-brand' : 'text-muted-foreground')}
              >
                <span className="relative">
                  <Icon className="size-[22px]" />
                  {count ? <span className="num absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--brand-amber)] px-1 text-[10px] font-bold text-[#111827]">{count}</span> : null}
                </span>
                {short}
              </NavLink>
            )
          })}
        </div>
      </nav>
    )
  }

  return (
    <nav aria-label="Secciones" className="mb-6 flex items-center gap-1 border-b border-line">
      {NAV_ITEMS.map(({ to, end, label, Icon, key }) => {
        const count = countOf(key)
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-2 px-3 py-3 text-[13px] font-medium transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-acc after:transition-transform after:duration-200',
                isActive ? 'text-foreground after:scale-x-100' : 'text-muted-foreground hover:text-foreground after:scale-x-0',
              )
            }
          >
            <Icon className="size-4" />
            {label}
            {count ? <Count n={count} /> : null}
          </NavLink>
        )
      })}
    </nav>
  )
}

/** Botonera de simulación de estado, solo en desarrollo. */
function DevSim({ sim, onSim }: { sim: SimState; onSim: (s: SimState) => void }) {
  const opts: [SimState, string][] = [[null, 'Real'], ['pagado', 'Al día'], ['pendiente', 'Sin pagar'], ['moroso', 'Con mora'], ['revision', 'En revisión']]
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/30 px-2.5 py-2 text-xs">
      <span className="px-1 font-semibold text-muted-foreground">Demo</span>
      {opts.map(([s, l]) => (
        <button
          key={l}
          type="button"
          onClick={() => onSim(s)}
          className={cn('rounded-lg px-2.5 py-1 font-medium transition-colors', sim === s ? 'bg-foreground text-background' : 'text-ink-2 hover:bg-accent')}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

/** Cuenta como ícono: iniciales → menú con nombre, correo, administración y cerrar sesión.
 * Mismo patrón que el panel (panel-app.tsx). */
function AccountMenu({ name, email, org }: { name: string; email: string; org?: string }) {
  const row = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors hover:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-xl transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent"
          aria-label={`Cuenta de ${name}`}
          title={name}
        >
          <span className="grid size-8 place-items-center rounded-[10px] bg-brand-soft text-[12px] font-bold text-brand" aria-hidden="true">{initials(name)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-2xl p-1.5">
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="text-[13px] font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          {org ? <p className="mt-1 text-xs text-muted-foreground">Administra {org}</p> : null}
        </div>
        <div className="my-1 h-px bg-line" />
        <button type="button" className={cn(row, 'text-bad [&_svg]:text-bad')} onClick={() => api.logout()}>
          <LogOutIcon />
          Cerrar sesión
        </button>
      </PopoverContent>
    </Popover>
  )
}
