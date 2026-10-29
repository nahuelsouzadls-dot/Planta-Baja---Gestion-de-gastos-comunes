import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, EllipsisVerticalIcon, Loader2Icon, ShareIcon, SquarePlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FormError, Input } from '@/components/ui/form'
import { useDocumentTitle } from '@/components/shared'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AuthLayout, PasswordInput } from './auth-layout'

const MIN_PASSWORD = 10

/** Después de entrar: empleados al panel, residentes al portal. Sin recargar la página:
 * se guarda la sesión en la caché y se navega dentro de la app (sin pantalla en blanco). */
function useGoHome() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  return async (fallback: string) => {
    const me = await api.get<Me>('auth/me', { noRedirect: true })
    qc.setQueryData(['me'], me)
    if (me.organizations.length) navigate('/panel', { replace: true })
    else if (me.persons.some((p) => p.occupancies.length)) navigate('/portal', { replace: true })
    else navigate(fallback, { replace: true })
  }
}

/** Envío de formulario con estado de carga y mensaje de error. */
function useSubmit<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const run = async (...args: T) => {
    setError('')
    setBusy(true)
    try {
      await fn(...args)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
      {busy ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  )
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-ok/20 bg-ok-bg p-4 text-[13px] text-ok">
      <CheckCircle2Icon className="mt-px size-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

// ── Ingresar ───────────────────────────────────────────────────────────
export function LoginPage({ audience }: { audience: 'admin' | 'resident' }) {
  const admin = audience === 'admin'
  useDocumentTitle(admin ? 'Ingresar · Administración' : 'Ingresar · Mi edificio')
  const [params] = useSearchParams()
  const goHome = useGoHome()
  // Mientras completás el formulario, el código del panel o del portal ya se descarga.
  React.useEffect(() => {
    void (admin ? import('@/features/panel/panel-app') : import('@/features/portal/portal-app'))
  }, [admin])
  const { busy, error, setError, run } = useSubmit(async (email: string, password: string) => {
    await api.post('auth/login', { email, password }, { noRedirect: true })
    await goHome(admin ? '/ingresar/administracion' : '/ingresar')
  })
  const expired = params.get('vencida') ? 'Tu sesión venció. Volvé a ingresar.' : ''

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const email = String(data.get('email') || '').trim()
    const password = String(data.get('password') || '')
    if (!email || !password) return setError('Completá tu correo y tu contraseña.')
    run(email, password)
  }

  return (
    <AuthLayout
      audience={audience}
      title={admin ? 'Panel de administración' : 'Ingresá a tu cuenta'}
      lead={admin ? 'Ingresá con tu correo y contraseña.' : 'Mirá tu liquidación y subí tus comprobantes.'}
      footer={
        admin ? (
          <>¿Sos residente? <Link className="font-medium text-foreground underline underline-offset-3" to="/ingresar">Ingresá al portal</Link></>
        ) : (
          <>¿Trabajás en la administración? <Link className="font-medium text-foreground underline underline-offset-3" to="/ingresar/administracion">Ingresá al panel</Link></>
        )
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Correo electrónico" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" placeholder={admin ? 'nombre@empresa.com' : 'nombre@correo.com'} className="h-10" autoFocus />
        </Field>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-medium text-ink-2">Contraseña</label>
            <Link to="/recuperar-contrasena" className="text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground">
              Olvidé mi contraseña
            </Link>
          </div>
          <PasswordInput id="password" name="password" autoComplete="current-password" />
        </div>
        <FormError>{error || expired}</FormError>
        <Submit busy={busy}>Ingresar</Submit>
      </form>
    </AuthLayout>
  )
}

// ── Contraseñas nuevas (restablecer e invitación) ──────────────────────
function readPasswords(form: HTMLFormElement): [string | null, string] {
  const data = new FormData(form)
  const password = String(data.get('password') || '')
  if (password.length < MIN_PASSWORD) return [null, `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`]
  if (password !== String(data.get('repeat') || '')) return [null, 'Las dos contraseñas no coinciden.']
  return [password, '']
}

function NewPasswordFields({ autoFocus = true }: { autoFocus?: boolean }) {
  return (
    <>
      <Field label="Nueva contraseña" htmlFor="password" hint={`Mínimo ${MIN_PASSWORD} caracteres.`}>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD} autoFocus={autoFocus} />
      </Field>
      <Field label="Repetila" htmlFor="repeat">
        <PasswordInput id="repeat" name="repeat" autoComplete="new-password" minLength={MIN_PASSWORD} />
      </Field>
    </>
  )
}

const backToLogin = <Link className="font-medium text-foreground underline underline-offset-3" to="/ingresar">Volver a ingresar</Link>

export function RecoverPasswordPage() {
  useDocumentTitle('Recuperar contraseña')
  const [sent, setSent] = React.useState(false)
  const { busy, error, setError, run } = useSubmit(async (email: string) => {
    await api.post('auth/password-reset', { email }, { noRedirect: true })
    setSent(true)
  })
  return (
    <AuthLayout audience="resident" title="Recuperar contraseña" lead="Escribí tu correo y te mandamos un link para elegir una nueva." footer={backToLogin}>
      {sent ? (
        <Done>Si el correo está registrado, te llega un link en unos minutos. Revisá también el correo no deseado.</Done>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const email = String(new FormData(e.currentTarget).get('email') || '').trim()
            if (!email) return setError('Escribí tu correo.')
            run(email)
          }}
        >
          <Field label="Correo electrónico" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" placeholder="nombre@correo.com" className="h-10" autoFocus />
          </Field>
          <FormError>{error}</FormError>
          <Submit busy={busy}>Enviar link</Submit>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  useDocumentTitle('Nueva contraseña')
  const [params] = useSearchParams()
  const [done, setDone] = React.useState(false)
  const { busy, error, setError, run } = useSubmit(async (password: string) => {
    await api.post('auth/password-reset/confirm', { uid: params.get('uid') || '', token: params.get('token') || '', password }, { noRedirect: true })
    setDone(true)
  })
  return (
    <AuthLayout audience="resident" title="Nueva contraseña" lead="Elegí una contraseña nueva para tu cuenta." footer={backToLogin}>
      {done ? (
        <Done>Listo, ya podés ingresar con tu nueva contraseña.</Done>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const [password, msg] = readPasswords(e.currentTarget)
            if (!password) return setError(msg)
            run(password)
          }}
        >
          <NewPasswordFields />
          <FormError>{error}</FormError>
          <Submit busy={busy}>Guardar contraseña</Submit>
        </form>
      )}
    </AuthLayout>
  )
}

interface Invite {
  unit: string
  building: string
}

/** Valida el código contra el backend (TODO Copilot: endpoint `invitations/lookup`).
 * En preview (dev) devuelve una unidad de muestra para ver el flujo sin backend. */
async function lookupInvite(code: string, stub: boolean): Promise<Invite> {
  if (stub) return { unit: '204', building: 'Edificio Minas' }
  return api.post<Invite>('invitations/lookup', { code }, { noRedirect: true })
}

/** Onboarding de invitación: código → confirmar unidad → contraseña → instalar la app.
 * El mail lo cargó la administración al crear al residente; el código asocia a la persona
 * con su unidad. Si el correo trae un link con ?token=, se saltea el paso del código. */
export function AcceptInvitationPage() {
  useDocumentTitle('Activar tu cuenta')
  const [params] = useSearchParams()
  const goHome = useGoHome()
  const token = params.get('token') || ''
  // Preview en dev: ?preview=code (desde el código) o ?preview=install (último paso).
  const previewParam = import.meta.env.DEV ? params.get('preview') : null
  const stub = previewParam === 'code' || previewParam === 'install'

  const [step, setStep] = React.useState<'code' | 'password' | 'install'>(
    previewParam === 'install' ? 'install' : previewParam === 'code' ? 'code' : token ? 'password' : 'code',
  )
  const [invite, setInvite] = React.useState<Invite | null>(null)
  const [code, setCode] = React.useState('')

  const lookup = useSubmit(async (value: string) => {
    setInvite(await lookupInvite(value, stub))
    setCode(value)
    setStep('password')
  })

  const accept = useSubmit(async (email: string, password: string) => {
    if (!stub) {
      await api.post('invitations/accept', token ? { token, email, password } : { code, email, password }, { noRedirect: true })
    }
    setStep('install')
  })

  if (step === 'install') {
    return (
      <AuthLayout audience="resident" title="¡Listo, cuenta activada!" lead="Un último paso opcional: instalá la app en tu celular para entrar con un toque.">
        <InstallApp onContinue={() => goHome('/ingresar')} />
      </AuthLayout>
    )
  }

  if (step === 'code') {
    return (
      <AuthLayout audience="resident" title="Activá tu cuenta" lead="Ingresá el código que te envió la administración por correo." footer={backToLogin}>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const value = String(new FormData(e.currentTarget).get('code') || '').trim()
            if (!value) return lookup.setError('Escribí el código que te enviaron.')
            lookup.run(value)
          }}
        >
          <Field label="Código de invitación" htmlFor="code" hint="Lo recibiste por correo de la administración.">
            <Input id="code" name="code" inputMode="text" autoComplete="one-time-code" autoFocus placeholder="Ej.: 840 215" className="num h-12 text-center text-[20px] font-semibold tracking-[0.25em]" />
          </Field>
          <FormError>{lookup.error}</FormError>
          <Submit busy={lookup.busy}>Continuar</Submit>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      audience="resident"
      title="Completá tus datos"
      lead={invite ? `Último paso para entrar al apartamento ${invite.unit}: tu correo y una contraseña.` : 'Ingresá tu correo y elegí una contraseña para entrar.'}
      footer={backToLogin}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const email = String(new FormData(e.currentTarget).get('email') || '').trim()
          const [password, msg] = readPasswords(e.currentTarget)
          if (!email) return accept.setError('Escribí tu correo.')
          if (!password) return accept.setError(msg)
          accept.run(email, password)
        }}
      >
        {invite ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-[13px] font-bold text-brand">{invite.unit}</span>
            <div className="text-[13px] leading-tight">
              <p className="font-semibold">Apartamento {invite.unit}</p>
              <p className="text-muted-foreground">{invite.building}</p>
            </div>
          </div>
        ) : null}
        <Field label="Tu correo electrónico" htmlFor="email" hint="El mismo que le diste a la administración.">
          <Input id="email" name="email" type="email" autoComplete="username" placeholder="nombre@correo.com" className="h-10" autoFocus />
        </Field>
        <NewPasswordFields autoFocus={false} />
        <FormError>{accept.error}</FormError>
        <Submit busy={accept.busy}>Activar cuenta</Submit>
      </form>
    </AuthLayout>
  )
}

// ── Instalar la app (PWA): instrucciones según iPhone / Android ─────────
const INSTALL = {
  ios: {
    label: 'iPhone',
    note: 'Abrí esta página en Safari.',
    steps: [
      { Icon: ShareIcon, text: <>Tocá el botón <b className="text-foreground">Compartir</b> en la barra de abajo.</> },
      { Icon: SquarePlusIcon, text: <>Bajá y elegí <b className="text-foreground">Agregar a inicio</b>.</> },
      { Icon: CheckCircle2Icon, text: <>Tocá <b className="text-foreground">Agregar</b>. Queda como una app en tu pantalla.</> },
    ],
  },
  android: {
    label: 'Android',
    note: 'Abrí esta página en Chrome.',
    steps: [
      { Icon: EllipsisVerticalIcon, text: <>Tocá el menú <b className="text-foreground">⋮</b> arriba a la derecha.</> },
      { Icon: SquarePlusIcon, text: <>Elegí <b className="text-foreground">Instalar app</b> (o <b className="text-foreground">Agregar a pantalla de inicio</b>).</> },
      { Icon: CheckCircle2Icon, text: <>Confirmá <b className="text-foreground">Instalar</b>. Queda como una app en tu pantalla.</> },
    ],
  },
} as const

function detectOS(): 'ios' | 'android' {
  return /android/i.test(navigator.userAgent) ? 'android' : 'ios'
}

/** Paso de onboarding: cómo instalar la PWA. Detecta el sistema y permite cambiarlo. */
function InstallApp({ onContinue }: { onContinue: () => void }) {
  const [os, setOs] = React.useState<'ios' | 'android'>(detectOS)
  const info = INSTALL[os]
  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="Tu teléfono" className="grid grid-cols-2 gap-1 rounded-xl border border-border p-1">
        {(['ios', 'android'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={os === k}
            onClick={() => setOs(k)}
            className={cn('rounded-lg py-2 text-[13px] font-semibold transition-colors', os === k ? 'bg-foreground text-background' : 'text-ink-2 hover:bg-accent')}
          >
            {INSTALL[k].label}
          </button>
        ))}
      </div>

      <ol className="grid gap-3">
        {info.steps.map(({ Icon, text }, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon className="size-[18px]" />
            </span>
            <span className="text-[14px] leading-snug text-ink-2">
              <b className="text-foreground">{i + 1}.</b> {text}
            </span>
          </li>
        ))}
      </ol>

      <p className="flex items-center gap-2 rounded-lg bg-acc-soft px-3 py-2 text-[12.5px] text-[color-mix(in_srgb,var(--acc)_75%,#000)]">
        <span className="size-1.5 shrink-0 rounded-full bg-[var(--brand-amber)]" aria-hidden="true" />
        {info.note}
      </p>

      <Button size="lg" className="mt-1 w-full" onClick={onContinue}>Entrar a la app</Button>
      <button type="button" onClick={onContinue} className="text-[13px] text-muted-foreground underline underline-offset-3 transition-colors hover:text-foreground">
        Lo instalo después, entrar ahora
      </button>
    </div>
  )
}
