# ADR-0004: Modelo de usuario propio con login por email

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
El login es por email (los residentes no tienen "username"). El `User` por defecto de Django exige `username`, y cambiar `AUTH_USER_MODEL` después de tener datos es muy costoso.

## Decisión
`accounts.User` propio, con `email` único en minúsculas (`UNIQUE(lower(email))`) como identificador, creado antes de la primera migración real. Las migraciones del esqueleto anterior se regeneran: no había datos reales.

## Alternativas descartadas
- Seguir con el `User` de Django y usar el email como username: duplica datos y deja casos de mayúsculas y minúsculas sin resolver.

## Consecuencias
- Todo el código usa `get_user_model()`.
- Una persona sin email puede existir como responsable de una unidad, pero no tiene usuario ([ADR-0006](0006-cuenta-corriente-por-ocupacion.md)).
