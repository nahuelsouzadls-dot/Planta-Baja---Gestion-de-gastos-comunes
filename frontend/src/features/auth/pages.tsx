import * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FormError, Input } from '@/components/ui/form'
import { useDocumentTitle } from '@/components/shared'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { AuthLayout, PasswordInput } from './auth-layout'

const MIN_PASSWORD = 10

/** Después de entrar: empleados al panel, residentes al portal. */
async function goHome(fallback: string) {
  const me = await api.get<Me>('auth/me', { noRedirect: true })
  if (me.organizations.length) location.href = '/panel'
  else if (me.persons.some((p) => p.occupancies.length)) location.href = '/portal'
  else location.href = fallback
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

function Submit({ busy, children, admin = false }: { busy: boolean; children: React.ReactNode; admin?: boolean }) {
  return (
    <Button type="submit" variant={admin ? 'default' : 'theme'} size="lg" className="mt-2 w-full" disabled={busy}>
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
        <Submit busy={busy} admin={admin}>Ingresar</Submit>
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

function NewPasswordFields() {
  return (
    <>
      <Field label="Nueva contraseña" htmlFor="password" hint={`Mínimo ${MIN_PASSWORD} caracteres.`}>
        <PasswordInput id="password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD} autoFocus />
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

export function AcceptInvitationPage() {
  useDocumentTitle('Activar tu cuenta')
  const [params] = useSearchParams()
  const { busy, error, setError, run } = useSubmit(async (password: string) => {
    await api.post('invitations/accept', { token: params.get('token') || '', password }, { noRedirect: true })
    await goHome('/ingresar')
  })
  return (
    <AuthLayout audience="resident" title="Activá tu cuenta" lead="Elegí una contraseña para entrar de ahora en adelante." footer={backToLogin}>
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
        <Submit busy={busy}>Activar cuenta</Submit>
      </form>
    </AuthLayout>
  )
}
