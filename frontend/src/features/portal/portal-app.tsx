import * as React from 'react'
import { useSearchParams } from 'react-router'
import { LogOutIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form'
import { Count, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { ErrorState, PbMark, ROLE_LABEL, SchemeSwitch, useDocumentTitle } from '@/components/shared'
import { api } from '@/lib/api'
import { date, money } from '@/lib/format'
import type { Me } from '@/lib/types'
import { localToday, storage } from '@/lib/utils'
import { occupanciesOf, useAccount, useClaims, useNotices } from './data'
import { PaymentCard } from './payment-card'
import { AvisosTab, ComprobantesTab, LiquidacionTab, ReclamosTab } from './tabs'

const OCC_KEY = 'gc-occupancy'
const TABS = ['liquidacion', 'comprobantes', 'avisos', 'reclamos'] as const
type Tab = (typeof TABS)[number]

export default function PortalApp({ me }: { me: Me }) {
  const occupancies = React.useMemo(() => occupanciesOf(me), [me])
  const [occId, setOccId] = React.useState(() => {
    const saved = storage.get(OCC_KEY)
    return (occupancies.find((o) => o.id === saved) ?? occupancies[0]).id
  })
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'liquidacion'
  const setTab = (t: string) => setParams(t === 'liquidacion' ? {} : { tab: t }, { replace: true })

  const today = localToday()
  const currentMonth = today.slice(0, 7)
  const account = useAccount(occId)
  const notices = useNotices(occId)
  const claims = useClaims(occId)
  const a = account.data
  useDocumentTitle(a ? `Mi cuenta · ${a.building}` : 'Mi cuenta')

  const openClaims = (claims.data ?? []).filter((c) => c.status !== 'resolved').length
  // Igual que la etiqueta "Nuevo" de la pestaña: avisos de los últimos 7 días.
  const newNotices = (notices.data ?? []).filter((n) => (Date.parse(today) - Date.parse(n.date)) / 86_400_000 <= 7).length

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0F2A3F]"><PbMark className="h-[22px] w-[25px]" /></span>
            <div className="min-w-0 leading-tight">
              {a ? (
                <>
                  <p className="truncate font-display text-[15px] font-bold">{a.building}</p>
                  <p className="truncate text-xs text-muted-foreground">Administra {a.organization}</p>
                </>
              ) : (
                <div className="grid gap-1.5"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-24" /></div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-muted-foreground sm:block">{date(today)}</span>
            <SchemeSwitch />
            <Button variant="ghost" onClick={() => api.logout()} aria-label="Cerrar sesión">
              <LogOutIcon />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </Button>
          </div>
        </header>

        {occupancies.length > 1 ? (
          <div className="mb-5 max-w-sm">
            <label htmlFor="occ" className="sr-only">Unidad</label>
            <NativeSelect
              id="occ"
              value={occId}
              onChange={(e) => {
                storage.set(OCC_KEY, e.target.value)
                setOccId(e.target.value)
                setTab('liquidacion')
              }}
            >
              {occupancies.map((o) => (
                <option key={o.id} value={o.id}>
                  Apto {o.unit_number} · {o.building_name} · {ROLE_LABEL[o.role]}
                  {o.end_date ? ' (cerrada)' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {account.error ? (
          <ErrorState message={account.error.message} onRetry={() => account.refetch()} />
        ) : !a ? (
          <div className="grid gap-4" aria-busy="true" aria-label="Cargando tu cuenta">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
        ) : (
          <div key={occId} className="grid animate-enter gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10">
            <div className="grid gap-5 lg:sticky lg:top-6">
              <section>
                <h1 className="text-[28px] leading-tight font-bold">
                  Hola, {a.first_name}
                  {a.status === 'pagado' ? ', estás al día' : ''}
                </h1>
                <p className="mt-1 text-[14px] text-muted-foreground">
                  Apartamento {a.unit} · {ROLE_LABEL[a.role]}
                  {a.role_note ? ` · ${a.role_note}` : ''}
                </p>
                {a.closed ? (
                  <p role="note" className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-[13px] text-warn">
                    Esta unidad ya no está a tu nombre.{' '}
                    {Number(a.balance) > 0 ? `Te queda por pagar ${money(a.balance, true)}.` : 'No tenés saldo pendiente.'}
                  </p>
                ) : null}
              </section>
              <PaymentCard account={a} currentMonth={currentMonth} occupancies={occupancies} />
              <p className="hidden text-center text-xs text-muted-foreground lg:block">
                ¿Dudas? Escribile a {a.organization.replace(/\.$/, '')}. También podés pedir la liquidación en papel.
              </p>
            </div>

            <Tabs value={tab} onValueChange={setTab} className="min-w-0">
              <TabsList aria-label="Secciones de tu cuenta">
                <TabsTrigger value="liquidacion">Mi liquidación</TabsTrigger>
                <TabsTrigger value="comprobantes">Mis comprobantes</TabsTrigger>
                <TabsTrigger value="avisos">Avisos <Count n={newNotices} /></TabsTrigger>
                <TabsTrigger value="reclamos">Problemas y reclamos <Count n={openClaims} /></TabsTrigger>
              </TabsList>
              <div className="mt-5 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_24_40/0.05)] sm:p-6">
                <TabsContent value="liquidacion"><LiquidacionTab account={a} currentMonth={currentMonth} /></TabsContent>
                <TabsContent value="comprobantes">
                  <ComprobantesTab
                    account={a}
                    onUploadAgain={() => {
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                      setTab('liquidacion')
                    }}
                  />
                </TabsContent>
                <TabsContent value="avisos"><AvisosTab account={a} today={today} /></TabsContent>
                <TabsContent value="reclamos"><ReclamosTab account={a} /></TabsContent>
              </div>
            </Tabs>
          </div>
        )}

        {a ? (
          <p className="mt-10 text-center text-xs text-muted-foreground lg:hidden">
            ¿Dudas? Escribile a {a.organization.replace(/\.$/, '')}. También podés pedir la liquidación en papel.
          </p>
        ) : null}
      </div>
    </div>
  )
}
