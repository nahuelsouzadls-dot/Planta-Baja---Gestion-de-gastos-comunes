import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Django en desarrollo (docker compose: web). */
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // En producción Django sirve el build como estáticos bajo /static/app/ (ADR-0018).
  base: command === 'build' ? '/static/app/' : '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Mismo origen para la cookie de sesión y el CSRF (ADR-0005): Django ve el pedido
      // como si viniera de su propio host.
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            req.setHeader('origin', BACKEND)
            req.setHeader('referer', BACKEND + '/')
          })
        },
      },
    },
  },
}))
