import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import './index.css'
import { TooltipProvider } from '@/components/ui/misc'
import { RequireRole, RootRedirect } from '@/app/session'
import { AcceptInvitationPage, LoginPage, RecoverPasswordPage, ResetPasswordPage } from '@/features/auth/pages'

const PanelApp = lazy(() => import('@/features/panel/panel-app'))
const PortalApp = lazy(() => import('@/features/portal/portal-app'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
})

const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/ingresar', element: <LoginPage audience="resident" /> },
  { path: '/ingresar/administracion', element: <LoginPage audience="admin" /> },
  { path: '/recuperar-contrasena', element: <RecoverPasswordPage /> },
  { path: '/restablecer-contrasena', element: <ResetPasswordPage /> },
  { path: '/aceptar-invitacion', element: <AcceptInvitationPage /> },
  {
    path: '/panel/*',
    element: <RequireRole role="employee">{(me) => <PanelApp me={me} />}</RequireRole>,
  },
  {
    path: '/portal/*',
    element: <RequireRole role="resident">{(me) => <PortalApp me={me} />}</RequireRole>,
  },
  { path: '*', element: <RootRedirect /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250}>
        <Suspense fallback={null}>
          <RouterProvider router={router} />
        </Suspense>
        <Toaster
          position="bottom-center"
          toastOptions={{
            classNames: {
              toast: '!rounded-lg !border-border !font-sans !text-[13px] !shadow-[0_16px_48px_rgb(11_18_32/0.16)]',
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
