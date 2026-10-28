/* Formato para mostrar. Los montos llegan como texto de la API ("4153.80"): acá solo se
 * formatean; nunca se usan para calcular (ADR-0011). */

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'setiembre', 'octubre', 'noviembre', 'diciembre',
]
export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']

const moneyFmt = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 })
const moneyFmtCents = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function money(value: string | number | null | undefined, withCents = false): string {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  const body = withCents ? moneyFmtCents.format(abs) : moneyFmt.format(Math.round(abs))
  return (n < 0 && body !== '0' && body !== '0,00' ? '− ' : '') + '$ ' + body
}

export function monthLong(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return MONTHS[m - 1] + ' ' + y
}

export function monthTitle(key: string): string {
  const s = monthLong(key)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function monthShort(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return MONTHS[m - 1].slice(0, 3) + ' ' + String(y).slice(2)
}

export const monthWord = (key: string) => monthLong(key).split(' ')[0]

export function date(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return d + ' ' + MONTHS[m - 1].slice(0, 3) + ' ' + y
}

export function dateShort(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  return d + ' ' + MONTHS[m - 1].slice(0, 3)
}

export function percent(coef: string | number): string {
  return (Number(coef) * 100).toFixed(2).replace('.', ',') + ' %'
}

/** "4153.80" → "4153,80" para un campo editable. */
export const comma = (amount: string) => String(amount).replace('.', ',')

/** Monto escrito por una persona → texto para la API: "4.153,80" o "4153.80" → "4153.80".
 * Devuelve null si no es un monto válido (positivo, hasta 2 decimales). Nunca pasa por Number. */
export function amountText(raw: string): string | null {
  const text = String(raw || '').trim()
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text
  return /^\d{1,9}(\.\d{1,2})?$/.test(normalized) && /[1-9]/.test(normalized) ? normalized : null
}

/** Nombre a mostrar de un archivo: las keys del almacenamiento (receipts/<org>/<uuid>) no dicen nada. */
export const fileLabel = (key: string | null | undefined) =>
  String(key || '').startsWith('receipts/') ? 'Comprobante' : String(key || '')

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join('')
    .replace(/[^A-ZÁÉÍÓÚÑ]/g, '')
    .slice(0, 2)
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
