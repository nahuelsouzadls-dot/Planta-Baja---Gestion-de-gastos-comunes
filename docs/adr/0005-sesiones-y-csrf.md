# ADR-0005: Sesiones de Django con CSRF, sin JWT

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
El front y la API comparten dominio ([ADR-0002](0002-front-estatico-js-puro.md)). Guardar tokens en `localStorage` los expone a cualquier XSS.

## Decisión
Autenticación por sesión de Django: cookie `HttpOnly`, `Secure` y `SameSite=Lax`, más el token CSRF en cada escritura. Contraseñas con Argon2 y bloqueo por intentos fallidos con `django-axes` (5 fallos por email e IP, 1 hora).

## Alternativas descartadas
- JWT en `localStorage`: robable por XSS y sin revocación simple.
- JWT en cookie: reinventa lo que ya hace la sesión de Django.

## Consecuencias
- Cerrar sesión o desactivar un usuario invalida el acceso al instante.
- Si en el futuro hay una app móvil, se agrega autenticación por token solo para ella.
