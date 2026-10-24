# ADR-0003: Aislamiento multi-tenant por organización

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
Varias administradoras usan el mismo sistema. Una nunca puede ver datos de otra. El esqueleto anterior aislaba por edificio, pero una administradora maneja varios edificios con los mismos usuarios.

## Decisión
La raíz es `Organization`. Los usuarios del panel pertenecen a organizaciones (`OrgMembership`); los residentes acceden por sus `Occupancy`. Toda consulta pasa por un filtro de alcance según el usuario autenticado, y lo que está fuera de su alcance responde 404.

## Alternativas descartadas
- Un esquema de Postgres por cliente: aislamiento fuerte, pero migraciones y operación mucho más complejas para un SaaS chico.
- RLS de Postgres desde el día uno: segunda capa valiosa, pero agrega complejidad a los tests y al pool de conexiones. Queda para más adelante, sobre la misma estructura.

## Consecuencias
- Cada endpoint tiene un test obligatorio: un usuario de otra organización recibe 404.
- La organización nunca se toma del body ni de la URL sin verificar.
