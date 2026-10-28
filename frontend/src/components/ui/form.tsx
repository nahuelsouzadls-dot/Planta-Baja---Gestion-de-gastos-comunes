import * as React from 'react'
import { Label as LabelPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

const fieldBase =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-[0_1px_1px_rgb(16_24_40/0.03)] transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-acc focus-visible:ring-[3px] focus-visible:ring-acc-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-bad aria-invalid:ring-bad/15'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(fieldBase, 'h-9', className)} {...props} />
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldBase, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
}

/** Select nativo con el estilo del sistema: en celular abre el selector del teléfono. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select data-slot="select" className={cn(fieldBase, 'h-9 appearance-none pr-8')} {...props}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
}

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-xs font-medium text-ink-2 select-none', className)}
      {...props}
    />
  )
}

/** Campo con etiqueta, ayuda y error. */
function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Mensaje de error de un formulario completo. */
function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-md bg-bad-bg px-3 py-2 text-[13px] font-medium text-bad">
      {children}
    </p>
  )
}

export { Input, Textarea, NativeSelect, Label, Field, FormError }
