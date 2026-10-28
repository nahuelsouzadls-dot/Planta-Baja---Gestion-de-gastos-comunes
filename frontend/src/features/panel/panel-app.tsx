import * as React from 'react'
import { Link, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router'
import { BellIcon, Building2Icon, ChevronRightIcon, LayoutGridIcon, LogOutIcon, MenuIcon, SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form'
import { Tooltip } from '@/components/ui/misc'
import { ErrorState, ThemePicker, useDocumentTitle, useTheme } from '@/components/shared'
import { api } from '@/lib/api'
import { initials } from '@/lib/format'
import type { Me } from '@/lib/types'
import { cn, localToday, storage } from '@/lib/utils'
import { FigsSkeleton, RowsSkeleton, useOverlay } from './bits'
import { BuildingPage } from './building'
import { PanelContext, useOrganizations, usePanel, usePortfolio } from './data'
import { Fabs } from './fabs'
import { HomePage } from './home'
import { ReceiptDialog } from './receipt-dialog'
import { UnitSheet } from './unit-sheet'

const ORG_KEY = 'gc-org'
const NAV_KEY = 'gc-nav-open'

export default function PanelApp({ me }: { me: Me }) {
  useTheme()
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
    <PanelContext.Provider value={{ orgId: effectiveOrg, orgs, setOrgId, query, setQuery, today: localToday() }}>
      <Shell me={me} />
    </PanelContext.Provider>
  )
}

function Shell({ me }: { me: Me }) {
  const { orgId } = usePanel()
  const portfolio = usePortfolio(orgId)
  const [navOpen, setNavOpen] = React.useState(() => storage.get(NAV_KEY) === '1')
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

      <div className={cn('transition-[padding] duration-300 ease-out-soft lg:pl-[104px]', navOpen && 'lg:pl-[272px]')}>
        <Topbar me={me} queueCount={portfolio.data?.receipt_queue.length ?? 0} firstReceipt={portfolio.data?.receipt_queue[0]?.id} onMenu={() => setMobileNav(true)} />
        <main className="mx-auto max-w-[1280px] px-4 pb-28 sm:px-6 sm:pr-20 lg:pl-0">
          {portfolio.error ? (
            <ErrorState message={portfolio.error.message} onRetry={() => portfolio.refetch()} />
          ) : !portfolio.data ? (
            <div className="grid gap-6 pt-2"><FigsSkeleton /><div className="rounded-lg border border-border bg-card"><RowsSkeleton /></div></div>
          ) : (
            <Routes>
              <Route index element={<HomePage portfolio={portfolio.data} />} />
              <Route path="edificio/:id/:tab?" element={<BuildingPage portfolio={portfolio.data} />} />
              <Route path="*" element={<HomePage portfolio={portfolio.data} />} />
            </Routes>
          )}
        </main>
        {portfolio.data ? <Fabs portfolio={portfolio.data} /> : null}
      </div>

      {portfolio.data ? (
        <>
          <UnitSheet month={portfolio.data.month} />
          <ReceiptDialog />
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

  const item = (to: string, label: string, icon: React.ReactNode, count?: number, end?: boolean) => (
    <NavItem key={to} to={to} label={label} icon={icon} count={count} end={end} expanded={expanded} />
  )

  return (
    <aside
      aria-label="Navegación"
      className={cn(
        'fixed inset-y-3 left-3 z-40 flex flex-col rounded-2xl bg-side text-white shadow-[0_16px_48px_rgb(11_18_32/0.22)] transition-[width,transform] duration-300 ease-out-soft',
        expanded ? 'w-[248px]' : 'w-[68px]',
        mobileOpen ? 'translate-x-0' : '-translate-x-[calc(100%+24px)] lg:translate-x-0',
      )}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true"><span className="glass" /></span>
      <div className="relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto p-3 [scrollbar-width:none]">
        <div className="flex items-center gap-3 px-1 pt-1 pb-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accl font-display text-[15px] font-bold text-side">{company.charAt(0)}</span>
          {expanded ? (
            <span className="min-w-0 leading-tight">
              <b className="block truncate font-display text-[14px]">{company}</b>
              <small className="text-[11px] text-white/60">Administración</small>
            </span>
          ) : null}
          {mobileOpen ? (
            <Button variant="ghost" size="icon-sm" className="ml-auto text-white hover:bg-white/10 lg:hidden" onClick={onMobileClose} aria-label="Cerrar menú">
              <XIcon />
            </Button>
          ) : null}
        </div>

        <nav className="grid gap-1" aria-label="Principal">
          {item('/panel', 'Cartera', <LayoutGridIcon />, queue, true)}
          <div className={cn('px-[11px] pt-5 pb-1.5 text-[10.5px] font-semibold tracking-wider text-white/45 uppercase', !expanded && 'sr-only')}>Edificios</div>
          {!expanded ? <div className="mx-3 my-2 h-px bg-white/15" aria-hidden="true" /> : null}
          {(portfolio?.buildings ?? []).map((b) => item(`/panel/edificio/${b.id}`, b.name, <Building2Icon />, b.counts.revision))}
        </nav>

        <div className="mt-auto grid gap-1">
          {(() => {
            const btn = (
              <button type="button" onClick={() => api.logout()} className="flex h-10 items-center gap-3 rounded-[10px] px-[11px] text-[13px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white">
                <LogOutIcon className="size-[18px] shrink-0" />
                <span className={cn(!expanded && 'sr-only')}>Cerrar sesión</span>
              </button>
            )
            return expanded ? btn : <Tooltip content="Cerrar sesión">{btn}</Tooltip>
          })()}
        </div>
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

/** Ítem de la barra lateral. El estado activo se calcula acá: el Tooltip (asChild) no puede
 * combinar el className-función de NavLink. */
function NavItem({ to, label, icon, count, end, expanded }: { to: string; label: string; icon: React.ReactNode; count?: number; end?: boolean; expanded: boolean }) {
  const { pathname } = useLocation()
  const active = end ? pathname === to || pathname === to + '/' : pathname.startsWith(to)
  const link = (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded-[10px] px-[11px] text-[13px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white',
        active && 'bg-white/[0.16] text-white',
      )}
    >
      <span className="shrink-0 [&_svg]:size-[18px]">{icon}</span>
      <span className={cn('min-w-0 flex-1 truncate', !expanded && 'sr-only')}>{label}</span>
      {count ? (
        <span className={cn('num grid h-5 min-w-5 place-items-center rounded-full bg-accl px-1.5 text-[11px] font-bold text-side', !expanded && 'absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]')}>
          {count}
        </span>
      ) : null}
    </Link>
  )
  return expanded ? link : <Tooltip content={label}>{link}</Tooltip>
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

function Topbar({ me, queueCount, firstReceipt, onMenu }: { me: Me; queueCount: number; firstReceipt?: string; onMenu: () => void }) {
  const { orgs, orgId, setOrgId, query, setQuery } = usePanel()
  const [theme, setTheme] = useTheme()
  const receipt = useOverlay('comprobante')
  const navigate = useNavigate()
  const inBuilding = useMatch('/panel/edificio/:id/*')
  const company = orgs.find((o) => o.id === orgId)?.name ?? ''
  const userName = [me.first_name, me.last_name].filter(Boolean).join(' ')
  const wide = useMediaQuery('(min-width: 640px)')
  useDocumentTitle(inBuilding ? 'Edificio · Administración' : 'Cartera · Administración')

  return (
    <header className="sticky top-0 z-20 mb-2 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1280px] items-center gap-3 px-4 sm:px-6 sm:pr-20 lg:pl-0">
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
          <ThemePicker theme={theme} onChange={setTheme} />
          <Button
            variant="outline"
            size="icon"
            className="relative"
            aria-label={queueCount ? `${queueCount} comprobantes por validar` : 'Sin comprobantes por validar'}
            onClick={() => (firstReceipt ? receipt.open(firstReceipt) : navigate('/panel'))}
          >
            <BellIcon />
            {queueCount ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-bad ring-2 ring-card" /> : null}
          </Button>
          <div className="hidden items-center gap-2.5 pl-1 sm:flex">
            <span className="grid size-9 place-items-center rounded-full bg-side text-xs font-bold text-white" aria-hidden="true">{initials(company)}</span>
            <span className="leading-tight">
              <b className="block text-[13px]">{company}</b>
              <small className="text-[11.5px] text-muted-foreground">{userName || 'Administración'}</small>
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
