import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router'

import { api, ApiError, PANEL_LOGIN, PORTAL_LOGIN } from '@/lib/api'
import type { Me } from '@/lib/types'
import { Splash } from '@/components/shared'

export const isEmployee = (me: Me) => me.organizations.length > 0
export const isResident = (me: Me) => me.persons.some((p) => p.occupancies.length > 0)

export function homeFor(me: Me | null | undefined): string | null {
  if (!me) return null
  if (isEmployee(me)) return '/panel'
  if (isResident(me)) return '/portal'
  return null
}

/** Sesión actual. `null` = sin sesión (401/403). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('auth/me', { noRedirect: true })
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
        throw err
      }
    },
    staleTime: 60_000,
  })
}

const FullScreenLoader = Splash

/** Solo deja pasar a quien corresponde; el resto va a su inicio o al login (igual que apps/frontend/views.py). */
export function RequireRole({ role, children }: { role: 'employee' | 'resident'; children: (me: Me) => React.ReactNode }) {
  const { data: me, isPending, error, refetch } = useMe()
  if (isPending) return <FullScreenLoader />
  if (error)
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="grid gap-3">
          <p className="text-[13px] text-muted-foreground">{(error as Error).message}</p>
          <button className="text-[13px] font-medium underline" onClick={() => refetch()}>Reintentar</button>
        </div>
      </div>
    )
  const login = role === 'employee' ? PANEL_LOGIN : PORTAL_LOGIN
  if (!me) return <Navigate to={login} replace />
  const allowed = role === 'employee' ? isEmployee(me) : isResident(me)
  if (!allowed) return <Navigate to={homeFor(me) ?? login} replace />
  return <>{children(me)}</>
}

/** La raíz manda a cada uno a su inicio. */
export function RootRedirect() {
  const { data: me, isPending } = useMe()
  if (isPending) return <FullScreenLoader />
  return <Navigate to={homeFor(me) ?? PORTAL_LOGIN} replace />
}
