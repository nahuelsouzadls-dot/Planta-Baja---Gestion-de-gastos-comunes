import * as React from 'react'
import { AlertCircleIcon, Building2Icon, CheckIcon, PaletteIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc'
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

export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      {children}
    </span>
  )
}

export function StatusPill({ status, label }: { status: AccountStatus; label?: string }) {
  const [tone, text] = STATUS[status] ?? STATUS['sin-cargar']
  return <Pill tone={tone}>{label ?? text}</Pill>
}

// ── Tema (compartido entre panel, portal y logins; persiste en localStorage) ──
export const THEMES = [
  ['lagoon', 'Lagoon', '#0e4a5e', '#12909f'],
  ['noche', 'Azul noche', '#14233d', '#2a86bd'],
  ['berenjena', 'Berenjena', '#3b1f45', '#1f9e80'],
  ['bosque', 'Bosque', '#1d3b2f', '#a97a2b'],
  ['grafito', 'Grafito', '#25282e', '#d9604f'],
] as const
export type ThemeId = (typeof THEMES)[number][0]
const THEME_KEY = 'gc-theme'

function readTheme(): ThemeId {
  const saved = storage.get(THEME_KEY)
  return (THEMES.find(([id]) => id === saved)?.[0] ?? 'lagoon') as ThemeId
}

/** Tema actual. Se aplica en <html data-theme> y se sincroniza entre pestañas. */
export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = React.useState<ThemeId>(readTheme)
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', THEMES.find(([id]) => id === theme)?.[2] ?? '#0e4a5e')
  }, [theme])
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setTheme(readTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const choose = React.useCallback((id: ThemeId) => {
    storage.set(THEME_KEY, id)
    setTheme(id)
  }, [])
  return [theme, choose]
}

export function ThemePicker({ theme, onChange }: { theme: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Elegir tema de color" title="Tema">
          <PaletteIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2">
        <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Tema de color</p>
        <div role="radiogroup" aria-label="Tema de color" className="grid gap-0.5">
          {THEMES.map(([id, label, side, acc]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              onClick={() => onChange(id)}
              className={cn(
                'flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent',
                theme === id && 'bg-accent font-semibold',
              )}
            >
              {/* Mini vista previa: barra lateral + página con acento */}
              <span className="flex h-7 w-11 overflow-hidden rounded-[5px] border border-border" aria-hidden="true">
                <span className="w-3" style={{ background: side }} />
                <span className="flex flex-1 items-end bg-[#f4f5f7] p-1">
                  <span className="h-1 w-full rounded-full" style={{ background: acc }} />
                </span>
              </span>
              <span className="flex-1">{label}</span>
              {theme === id ? <CheckIcon className="size-4" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-[10px] bg-side text-accl', className)}>
      <Building2Icon className="size-[18px]" strokeWidth={1.8} />
    </span>
  )
}

/** Título de la pestaña del navegador. */
export function useDocumentTitle(title: string) {
  React.useEffect(() => {
    document.title = title
  }, [title])
}
