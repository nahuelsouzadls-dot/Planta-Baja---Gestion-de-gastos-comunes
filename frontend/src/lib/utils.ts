import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Fecha local de hoy como YYYY-MM-DD. */
export function localToday(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** Porcentaje entero para barras y textos (solo visual). */
export function pct(part: string | number, whole: string | number): number {
  const w = Number(whole)
  return w ? Math.round((Number(part) / w) * 100) : 0
}

/** localStorage que nunca rompe (modo privado, almacenamiento bloqueado). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* sin almacenamiento: dura la sesión */
    }
  },
}
