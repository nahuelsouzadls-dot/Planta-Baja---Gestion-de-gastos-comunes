import * as React from 'react'
import { AlertCircleIcon, CircleCheckIcon, CircleDashedIcon, CircleMinusIcon, Clock3Icon, MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AccountStatus, Role } from '@/lib/types'
import { cn, storage } from '@/lib/utils'

export const ROLE_LABEL: Record<Role, string> = { owner: 'Propietario', tenant: 'Inquilino' }

// ── Estados ────────────────────────────────────────────────────────────
export type Tone = 'ok' | 'warn' | 'pend' | 'bad' | 'none'

const TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  pend: 'bg-pend-bg text-pend',
  bad: 'bg-bad-bg text-bad',
  none: 'bg-muted text-muted-foreground',
}

export const STATUS: Record<AccountStatus, [Tone, string]> = {
  pagado: ['ok', 'Al día'],
  revision: ['warn', 'En revisión'],
  pendiente: ['pend', 'Pendiente'],
  moroso: ['bad', 'Moroso'],
  'sin-cargar': ['none', 'Sin liquidación'],
}

/** Ícono de cada estado: el estado nunca depende solo del color. */
const TONE_ICON: Record<Tone, React.ComponentType<React.SVGProps<SVGSVGElement> & { strokeWidth?: number }>> = {
  ok: CircleCheckIcon,
  warn: Clock3Icon,
  pend: CircleDashedIcon,
  bad: AlertCircleIcon,
  none: CircleMinusIcon,
}

export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      data-slot="pill"
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {React.createElement(TONE_ICON[tone], { className: 'size-3.5 shrink-0', 'aria-hidden': true, strokeWidth: 2.25 })}
      {children}
    </span>
  )
}

export function StatusPill({ status, label }: { status: AccountStatus; label?: string }) {
  const [tone, text] = STATUS[status] ?? STATUS['sin-cargar']
  return <Pill tone={tone}>{label ?? text}</Pill>
}

// ── Tema claro / noche (por navegador; index.html lo aplica antes de pintar) ──
type Scheme = 'light' | 'dark'
const SCHEME_KEY = 'pb-scheme'
const readScheme = (): Scheme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

export function useScheme(): [Scheme, () => void] {
  const [scheme, setScheme] = React.useState<Scheme>(readScheme)
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme === 'dark' ? '#0e1116' : '#0f2a3f')
  }, [scheme])
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === SCHEME_KEY && setScheme(e.newValue === 'dark' ? 'dark' : 'light')
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const toggle = React.useCallback(() => {
    setScheme((s) => {
      const next = s === 'dark' ? 'light' : 'dark'
      storage.set(SCHEME_KEY, next)
      return next
    })
  }, [])
  return [scheme, toggle]
}

/** Un solo ícono: luna en el tema claro (pasa a noche), sol en el noche (pasa a claro). */
export function SchemeSwitch({ className }: { className?: string }) {
  const [scheme, toggle] = useScheme()
  const dark = scheme === 'dark'
  const label = dark ? 'Cambiar a tema claro' : 'Cambiar a tema noche'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-10 place-items-center rounded-xl text-ink-2 transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {dark ? <SunIcon className="size-[19px]" /> : <MoonIcon className="size-[19px]" />}
    </button>
  )
}

// ── Estados de pantalla ────────────────────────────────────────────────
export function Empty({ title, children, icon, className }: { title?: string; children?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-1 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      {title ? <p className="text-[13px] font-semibold">{title}</p> : null}
      {children ? <div className="max-w-sm text-[13px] text-muted-foreground">{children}</div> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-bad/20 bg-bad-bg/60 p-5">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-bad">
        <AlertCircleIcon className="size-4" />
        {message}
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  )
}

/** Título de la pestaña del navegador. */
export function useDocumentTitle(title: string) {
  React.useEffect(() => {
    document.title = title
  }, [title])
}

/** Escalerita de Planta Baja (la de la landing), redibujada para tamaño ícono:
 * tres escalones celestes con el contraescalón más oscuro y el último en ámbar (planta baja). */
export function PbMark({ className }: { className?: string; onDark?: boolean }) {
  const steps = [0, 1, 2, 3]
  return (
    <svg viewBox="0 0 32 28" className={className} aria-hidden="true">
      {steps.map((i) => {
        const x = 1 + i * 7
        const y = 2 + i * 6
        const last = i === 3
        return (
          <g key={i}>
            <rect x={x} y={y} width="8" height="3.2" rx=".6" fill={last ? '#F5B800' : '#53B2EC'} />
            <rect x={x + 5.6} y={y + 3.2} width="2.4" height={last ? 4 : 2.8} fill={last ? '#C89200' : '#2E95D6'} />
          </g>
        )
      })}
    </svg>
  )
}
