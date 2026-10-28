import * as React from 'react'
import { Link, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router'
import { Building2Icon, Clock3Icon, InboxIcon, CalendarCheckIcon, HistoryIcon, MessageSquareIcon, ChevronRightIcon, LayoutGridIcon, LogOutIcon, MenuIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/misc'
import { ErrorState, PbMark, SchemeSwitch, useDocumentTitle } from '@/components/shared'
import { api } from '@/lib/api'
import { initials, money } from '@/lib/format'
import type { Me, Portfolio } from '@/lib/types'
import { cn, localToday, storage } from '@/lib/utils'
import { FigsSkeleton, RowsSkeleton, useOverlay } from './bits'
import { BuildingPage } from './building'
import { PanelContext, useOrganizations, usePanel, usePortfolio } from './data'
import { AgendaPage } from './agenda'
import { CommunicationsPage } from './communications'
import { HistoryPage } from './history'
import { HomePage } from './home'
import { ReceiptDialog } from './receipt-dialog'
import { SetupDialogs } from './setup'
import { HelpButton, HelpSheet } from '@/features/help/help'
import { UnitSheet } from './unit-sheet'

const ORG_KEY = 'gc-org'
const NAV_KEY = 'gc-nav-open'

export default function PanelApp({ me }: { me: Me }) {
  const orgsQ = useOrganizations()
  const [orgId, setOrgIdState] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const navigate = useNavigate()

  const orgs = orgsQ.data ?? []
  const saved = storage.get(ORG_KEY)
  const effectiveOrg = orgId ?? (orgs.find((o) => o.id === saved) ?? orgs[0])?.id ?? null
  const setOrgId = React.useCallback(
    (id: string) => {
      storage.set(ORG_KEY, id)
      setOrgIdState(id)
      navigate('/panel')
    },
    [navigate],
  )

  if (orgsQ.error) return <div className="p-8"><ErrorState message={orgsQ.error.message} onRetry={() => orgsQ.refetch()} /></div>
  if (orgsQ.isPending) return null
  if (!effectiveOrg) return <div className="p-8"><ErrorState message="Tu usuario no pertenece a ninguna administración." /></div>

  return (
    <PanelContext.Provider value={{ orgId: effectiveOrg, orgs, setOrgId, query, setQuery, today: localToday(), userName: me.first_name }}>
      <Shell me={me} />
    </PanelContext.Provider>
  )
}

function Shell({ me }: { me: Me }) {
  const { orgId } = usePanel()
  const portfolio = usePortfolio(orgId)
  const [navOpen, setNavOpen] = React.useState(() => storage.get(NAV_KEY) !== '0')
  const [mobileNav, setMobileNav] = React.useState(false)
  const location = useLocation()
  React.useEffect(() => setMobileNav(false), [location.pathname])

  const toggleNav = () => {
    storage.set(NAV_KEY, navOpen ? '0' : '1')
    setNavOpen(!navOpen)
  }

  return (
    <div className="min-h-dvh">
      {/* Barra lateral flotante: en escritorio se pliega a íconos; en celular es un panel. */}
      <Sidebar portfolio={portfolio.data} open={navOpen} onToggle={toggleNav} mobileOpen={mobileNav} onMobileClose={() => setMobileNav(false)} />
      {mobileNav ? <button type="button" aria-label="Cerrar menú" className="fixed inset-0 z-30 bg-[#0b1220]/35 lg:hidden" onClick={() => setMobileNav(false)} /> : null}

      <div className={cn('transition-[padding] duration-300 ease-out-soft lg:pl-[92px]', navOpen && 'lg:pl-[272px]')}>
        <Topbar me={me} portfolio={portfolio.data} onMenu={() => setMobileNav(true)} />
        <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6 lg:pr-8 lg:pl-0">
          {portfolio.error ? (
            <ErrorState message={portfolio.error.message} onRetry={() => portfolio.refetch()} />
          ) : !portfolio.data ? (
            <div className="grid gap-6 pt-2"><FigsSkeleton /><div className="rounded-lg border border-border bg-card"><RowsSkeleton /></div></div>
          ) : (
            <Routes>
              <Route index element={<HomePage portfolio={portfolio.data} />} />
              <Route path="agenda" element={<AgendaPage portfolio={portfolio.data} />} />
              <Route path="comunicaciones" element={<CommunicationsPage portfolio={portfolio.data} />} />
              <Route path="historial" element={<HistoryPage portfolio={portfolio.data} />} />
              <Route path="edificio/:id/:tab?" element={<BuildingPage portfolio={portfolio.data} />} />
              <Route path="*" element={<HomePage portfolio={portfolio.data} />} />
            </Routes>
          )}
        </main>
      </div>

      {portfolio.data ? (
        <>
          <UnitSheet month={portfolio.data.month} />
          <ReceiptDialog />
          <SetupDialogs portfolio={portfolio.data} />
          <HelpSheet />
        </>
      ) : null}
    </div>
  )
}

function Sidebar({
  portfolio, open, onToggle, mobileOpen, onMobileClose,
}: {
  portfolio: ReturnType<typeof usePortfolio>['data']
  open: boolean
  onToggle: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}) {
  const { orgs, orgId } = usePanel()
  const company = orgs.find((o) => o.id === orgId)?.name ?? ''
  const queue = portfolio?.receipt_queue.length ?? 0
  const expanded = open || mobileOpen

  const item = (to: string, label: string, icon: React.ReactNode, count?: number, end?: boolean, badgeTitle = 'Comprobantes por validar') => (
    <NavItem key={to} to={to} label={label} icon={icon} count={count} end={end} expanded={expanded} badgeTitle={badgeTitle} />
  )

  return (
    <aside
      aria-label="Navegación"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-card text-foreground transition-[width,transform] duration-300 ease-out-soft',
        expanded ? 'w-[248px]' : 'w-[68px]',
        mobileOpen ? 'translate-x-0 shadow-[16px_0_48px_rgb(17_24_39/0.12)]' : '-translate-x-full lg:translate-x-0',
      )}
    >
      <div className="relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto p-3 [scrollbar-width:none]">
        <div className="flex h-12 items-center gap-2.5 px-[9px] pb-3">
          <PbMark className="h-[30px] w-[34px] shrink-0" />
          {expanded ? (
            <span className="min-w-0 leading-tight">
              <b className="block truncate text-[15px] font-bold tracking-[-0.02em]">
                <span className="text-[var(--brand)]">P</span>lanta <span className="text-[var(--brand)]">B</span>aja
              </b>
              <small className="block truncate text-[11px] text-muted-foreground">{company}</small>
            </span>
          ) : null}
          {mobileOpen ? (
            <Button variant="ghost" size="icon-sm" className="ml-auto lg:hidden" onClick={onMobileClose} aria-label="Cerrar menú">
              <XIcon />
            </Button>
          ) : null}
        </div>

        <nav className="grid gap-1" aria-label="Principal">
          {item('/panel', 'Vista general', <LayoutGridIcon />, queue, true)}
          {item('/panel/agenda', 'Agenda', <CalendarCheckIcon />)}
          {item('/panel/comunicaciones', 'Comunicaciones', <MessageSquareIcon />, portfolio?.portfolio_totals.open_claims, false, 'Reclamos abiertos')}
          {item('/panel/historial', 'Historial', <HistoryIcon />)}
          <div className={cn('px-[11px] pt-5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase', !expanded && 'sr-only')}>Edificios</div>
          {!expanded ? <div className="mx-3 my-2 h-px bg-line" aria-hidden="true" /> : null}
          {(portfolio?.buildings ?? []).map((b) => item(`/panel/edificio/${b.id}`, b.name, <Building2Icon />, b.counts.revision))}
          <NewBuildingItem expanded={expanded} />
        </nav>

      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? 'Plegar el menú' : 'Desplegar el menú'}
        aria-expanded={open}
        className="absolute top-[64px] right-0 hidden size-6 translate-x-1/2 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition-transform hover:scale-110 lg:grid"
      >
        <ChevronRightIcon className={cn('size-3.5 transition-transform duration-300', open && 'rotate-180')} />
      </button>
    </aside>
  )
}

function NewBuildingItem({ expanded }: { expanded: boolean }) {
  const alta = useOverlay('alta')
  const btn = (
    <button
      type="button"
      onClick={() => alta.open('edificio')}
      className="flex h-10 w-full items-center gap-3 rounded-lg px-[11px] text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft"
    >
      <span className="grid size-[18px] shrink-0 place-items-center rounded-md border border-dashed border-current"><PlusIcon className="size-3" /></span>
      <span className={cn(!expanded && 'sr-only')}>Nuevo edificio</span>
    </button>
  )
  return expanded ? btn : <Tooltip content="Nuevo edificio">{btn}</Tooltip>
}

/** Ítem de la barra lateral. El estado activo se calcula acá: el Tooltip (asChild) no puede
 * combinar el className-función de NavLink. */
function NavItem({ to, label, icon, count, end, expanded, badgeTitle }: { to: string; label: string; icon: React.ReactNode; count?: number; end?: boolean; expanded: boolean; badgeTitle: string }) {
  const { pathname } = useLocation()
  const active = end ? pathname === to || pathname === to + '/' : pathname.startsWith(to)
  const link = (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded-lg px-[11px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand [&_svg]:text-muted-foreground [&_svg]:transition-colors hover:[&_svg]:text-brand',
        active && 'bg-acc-soft text-foreground before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)] [&_svg]:text-[var(--brand)]',
      )}
    >
      <span className="shrink-0 [&_svg]:size-[18px]">{icon}</span>
      <span className={cn('min-w-0 flex-1 truncate', !expanded && 'sr-only')}>{label}</span>
      {count ? (
        <span title={badgeTitle} className={cn('num grid h-5 min-w-5 place-items-center rounded-full bg-[var(--brand-amber)] px-1.5 text-[11px] font-bold text-[#111827]', !expanded && 'absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]')}>
          {count}
        </span>
      ) : null}
    </Link>
  )
  return expanded ? link : <Tooltip content={label}>{link}</Tooltip>
}

/** Pendientes de la administración: comprobantes por validar y reclamos abiertos. */
function Inbox({ portfolio }: { portfolio?: Portfolio }) {
  const receipt = useOverlay('comprobante')
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const queue = portfolio?.receipt_queue ?? []
  const claims = portfolio?.portfolio_totals.open_claims ?? 0
  const total = queue.length + claims
  const go = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={total ? `${total} pendientes` : 'Sin pendientes'}
          className="relative grid size-10 place-items-center rounded-xl text-ink-2 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent"
        >
          <InboxIcon className="size-[19px]" />
          {total ? (
            <span className="num absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--brand-amber)] px-1 text-[10.5px] font-bold text-[#111827] ring-2 ring-background">{total}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] rounded-2xl p-1.5">
        <p className="px-2.5 pt-2 pb-1.5 text-[13px] font-semibold">Pendientes</p>
        {!total ? <p className="px-2.5 pb-3 text-[13px] text-muted-foreground">Nada por hacer. Todo validado y respondido.</p> : null}
        {queue.slice(0, 5).map((r) => (
          <button key={r.id} type="button" onClick={go(() => receipt.open(r.id))} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warn-bg text-warn"><Clock3Icon className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{r.person}</span>
              <span className="block truncate text-xs text-muted-foreground">Comprobante · {r.building}, apto {r.unit}</span>
            </span>
            <span className="num text-[13px] font-semibold text-warn">{money(r.amount)}</span>
          </button>
        ))}
        {queue.length > 5 ? (
          <button type="button" onClick={go(() => navigate('/panel'))} className="w-full rounded-xl px-2.5 py-2 text-left text-xs font-medium text-brand hover:bg-accent">
            Ver los {queue.length} comprobantes
          </button>
        ) : null}
        {claims ? (
          <button type="button" onClick={go(() => navigate('/panel/comunicaciones'))} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><MessageSquareIcon className="size-4" /></span>
            <span className="flex-1 text-[13px] font-medium">{claims === 1 ? '1 reclamo abierto' : `${claims} reclamos abiertos`}</span>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function AccountMenu({ name, email, company }: { name: string; email: string; company: string }) {
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
      <PopoverContent className="w-64 rounded-2xl p-1.5">
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="text-[13px] font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <p className="mt-1 text-xs text-muted-foreground">{company}</p>
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

function useMediaQuery(query: string) {
  const [match, setMatch] = React.useState(() => window.matchMedia(query).matches)
  React.useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

function Topbar({ me, portfolio, onMenu }: { me: Me; portfolio?: Portfolio; onMenu: () => void }) {
  const { orgs, orgId, setOrgId, query, setQuery } = usePanel()
  const inBuilding = useMatch('/panel/edificio/:id/*')
  const company = orgs.find((o) => o.id === orgId)?.name ?? ''
  const userName = [me.first_name, me.last_name].filter(Boolean).join(' ')
  const wide = useMediaQuery('(min-width: 640px)')
  useDocumentTitle(inBuilding ? 'Edificio · Administración' : 'Vista general · Administración')

  return (
    <header className="sticky top-0 z-20 mb-2 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1280px] items-center gap-3 px-4 sm:px-6 lg:pr-8 lg:pl-0">
        <Button variant="outline" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Abrir menú">
          <MenuIcon />
        </Button>
        <label className="relative w-full max-w-[340px]">
          <span className="sr-only">Buscar</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            maxLength={60}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={wide ? 'Buscar edificio, unidad o residente' : 'Buscar'}
            className="h-9 w-full rounded-md border border-border bg-card pr-3 pl-9 text-[13px] shadow-[0_1px_1px_rgb(16_24_40/0.03)] outline-none placeholder:text-muted-foreground/80 focus-visible:border-acc focus-visible:ring-[3px] focus-visible:ring-acc-soft"
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {orgs.length > 1 ? (
            <NativeSelect aria-label="Administración" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="hidden w-48 md:block">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          ) : null}
          <HelpButton />
          <SchemeSwitch />
          <Inbox portfolio={portfolio} />
          <AccountMenu name={userName || 'Administración'} email={me.email} company={company} />
        </div>
      </div>
    </header>
  )
}
