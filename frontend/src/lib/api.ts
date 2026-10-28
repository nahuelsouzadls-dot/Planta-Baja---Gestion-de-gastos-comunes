/*
 * Cliente de la API (/api/v1/). Mismo origen: cookie de sesión + token CSRF (ADR-0005).
 * Los montos viajan siempre como texto y este módulo nunca los convierte a número (ADR-0011).
 */

const BASE = '/api/v1/'
export const PANEL_LOGIN = '/ingresar/administracion'
export const PORTAL_LOGIN = '/ingresar'

/** Error con el mensaje que devuelve la API (`detail`) y la lista completa (`errors`). */
export class ApiError extends Error {
  status: number
  errors: unknown[]
  constructor(status: number, message: string, errors?: unknown[]) {
    super(message)
    this.status = status
    this.errors = errors ?? []
  }
}

function cookie(name: string): string {
  const match = document.cookie.split('; ').find((c) => c.startsWith(name + '='))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

function loginUrl(): string {
  return location.pathname.startsWith('/panel') ? PANEL_LOGIN : PORTAL_LOGIN
}

let redirecting = false

/** 401/403: si /auth/me también falla, la sesión venció. */
async function sessionExpired(): Promise<boolean> {
  try {
    const res = await fetch(BASE + 'auth/me', { credentials: 'same-origin' })
    return res.status === 401 || res.status === 403
  } catch {
    return false
  }
}

export interface RequestOptions {
  /** No redirigir al login si la sesión venció (pantallas de acceso, archivos opcionales). */
  noRedirect?: boolean
}

let csrfReady: Promise<void> | null = null
/** Garantiza la cookie csrftoken antes del primer POST (por ejemplo, en el login). */
function ensureCsrf(): Promise<void> {
  if (cookie('csrftoken')) return Promise.resolve()
  csrfReady ??= fetch(BASE + 'auth/csrf', { credentials: 'same-origin' }).then(() => undefined)
  return csrfReady
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const init: RequestInit = { method, credentials: 'same-origin', headers }
  if (method !== 'GET') {
    await ensureCsrf()
    headers['X-CSRFToken'] = cookie('csrftoken')
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(BASE + path.replace(/^\//, ''), init)
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisá tu internet y probá de nuevo.')
  }

  if (res.status === 204) return null as T
  let data: { detail?: string; errors?: unknown[] } | null = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (res.ok) return data as T

  if (res.status === 429) throw new ApiError(429, 'Demasiados intentos, probá en unos minutos.')
  if ((res.status === 401 || res.status === 403) && !opts.noRedirect && (await sessionExpired())) {
    if (!redirecting) {
      redirecting = true
      location.href = loginUrl() + '?vencida=1'
    }
    throw new ApiError(res.status, 'Tu sesión venció. Volvé a ingresar.')
  }
  const message =
    data?.detail ?? (res.status === 404 ? 'No encontramos lo que buscabas.' : 'Algo salió mal. Probá de nuevo.')
  throw new ApiError(res.status, message, data?.errors)
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),

  async logout() {
    const target = location.pathname.startsWith('/panel') ? PANEL_LOGIN : PORTAL_LOGIN
    try {
      await request('POST', 'auth/logout', undefined, { noRedirect: true })
    } catch {
      /* igual se sale */
    }
    location.href = target
  },
}

/** URL de descarga directa (Excel): el navegador la baja con la cookie de sesión. */
export const apiUrl = (path: string) => BASE + path.replace(/^\//, '')

/** Abre una URL firmada que se pide a la API, sin que el navegador bloquee la ventana. */
export async function openSigned(req: Promise<{ url: string }>) {
  const win = window.open('', '_blank')
  try {
    const data = await req
    if (win) win.location.href = data.url
    else location.href = data.url
  } catch (err) {
    win?.close()
    throw err
  }
}
