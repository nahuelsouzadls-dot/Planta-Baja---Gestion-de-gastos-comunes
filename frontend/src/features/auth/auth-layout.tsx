import * as React from 'react'
import { Link } from 'react-router'
import { CheckIcon } from 'lucide-react'

import { PbMark, SchemeSwitch } from '@/components/shared'

const POINTS = {
  admin: ['Liquidaciones con prorrateo por coeficiente', 'Comprobantes validados contra el banco', 'Cobros, morosidad y reclamos de toda la cartera'],
  resident: ['Tu liquidación del mes, con el detalle de cada gasto', 'Subí el comprobante de la transferencia desde el celular', 'Avisos del edificio y tus reclamos en un solo lugar'],
}

/** Pantallas de acceso: panel de marca (azul noche con acentos amarillos) y formulario. */
export function AuthLayout({
  audience,
  title,
  lead,
  children,
  footer,
}: {
  audience: 'admin' | 'resident'
  title: string
  lead: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <aside className="relative isolate flex shrink-0 flex-col overflow-hidden bg-[#0F2A3F] px-6 py-6 text-white lg:w-[44%] lg:max-w-[620px] lg:px-12 lg:py-10">
        <Link to={audience === 'admin' ? '/ingresar/administracion' : '/ingresar'} className="flex items-center gap-3 self-start rounded-md">
          <PbMark className="h-[30px] w-[34px]" />
          <span className="text-base font-bold tracking-[-0.02em]"><span className="text-[#53B2EC]">P</span>lanta <span className="text-[#53B2EC]">B</span>aja</span>
        </Link>
        <div className="hidden flex-1 flex-col justify-center lg:flex">
          <span className="mb-5 inline-flex items-center gap-2 self-start rounded-full bg-[rgb(245_184_0/0.14)] px-3 py-1 text-xs font-semibold text-[#F5B800]">
            <span className="size-1.5 rounded-full bg-[#F5B800]" aria-hidden="true" />
            {audience === 'admin' ? 'Panel de administración' : 'Portal de residentes'}
          </span>
          <p className="font-display text-[34px] leading-[1.1] font-bold text-balance">
            {audience === 'admin' ? (
              <>El mes de cada edificio, <span className="text-[#F5B800]">en orden.</span></>
            ) : (
              <>Tu edificio, <span className="text-[#F5B800]">al día</span> y sin papeles.</>
            )}
          </p>
          <ul className="mt-8 grid gap-3.5">
            {POINTS[audience].map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] text-white/85">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#F5B800] text-[#0F2A3F]">
                  <CheckIcon className="size-3" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden items-center gap-2 text-xs text-white/60 lg:flex">
          <span className="h-px w-6 bg-[#F5B800]" aria-hidden="true" />
          Montevideo, Uruguay · Ley 10.751 de Propiedad Horizontal
        </p>
      </aside>

      <main className="relative flex flex-1 items-start justify-center px-5 pt-10 pb-10 sm:px-8 lg:items-center lg:pt-10">
        <SchemeSwitch className="absolute top-4 right-4" />
        <div className="w-full max-w-[380px] animate-enter">
          <span className="mb-4 block h-1 w-10 rounded-full bg-[var(--brand-amber)]" aria-hidden="true" />
          <h1 className="text-[26px] font-bold">{title}</h1>
          <p className="mt-1.5 text-[14px] text-muted-foreground">{lead}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-8 border-t border-line pt-5 text-center text-[13px] text-muted-foreground">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}

/** Campo de contraseña con "Mostrar / Ocultar". */
export function PasswordInput({ id, ...props }: React.ComponentProps<'input'> & { id: string }) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className="h-10 w-full rounded-md border border-input bg-card px-3 pr-20 text-sm shadow-[0_1px_1px_rgb(16_24_40/0.03)] transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-acc focus-visible:ring-[3px] focus-visible:ring-acc-soft"
        {...props}
      />
      <button
        type="button"
        aria-controls={id}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
        className="absolute top-1/2 right-1.5 h-7 -translate-y-1/2 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {show ? 'Ocultar' : 'Mostrar'}
      </button>
    </div>
  )
}
