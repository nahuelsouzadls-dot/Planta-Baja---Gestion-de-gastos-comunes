# Tarea: C3b — API del panel: escritura

## Contexto
C3a (lectura) está auditada. Ahora, todo lo que el panel **escribe**. Cada endpoint **solo traduce HTTP y llama al servicio de dominio que ya existe y está probado** (con sus permisos, su log y sus eventos). Ninguna regla de negocio nueva en las vistas.

**No hagas commit.**

## Reglas para todos los endpoints de escritura
- `IsEmployee` y alcance de C2: el objeto de la URL se obtiene con `get_in_scope_or_404` **antes** de llamar al servicio (lo ajeno → 404).
- CSRF obligatorio (sesión de Django).
- Errores: `ValidationError` del servicio → **400** `{"detail": "..."}` (si trae varios mensajes, el primero en `detail` y la lista en `errors`); `PermissionDenied` → **403**; `TypeError` por montos `float` → **400** con un mensaje claro.
- Montos en el cuerpo como **string** (`"2615.00"`); si llega un número JSON → 400 "Los montos se envían como texto".
- Respuesta: el objeto creado o modificado, con el mismo formato que su endpoint de lectura de C3a (reusá los serializers).
- Cada escritura deja su `AuditLog` (lo hace el servicio).

## Endpoints
| Método y ruta | Servicio |
|---|---|
| `POST /api/v1/organizations/{org}/buildings` | `create_building` |
| `POST /api/v1/buildings/{id}/units` | `add_unit` |
| `POST /api/v1/organizations/{org}/people` · `PATCH /api/v1/people/{id}` | `create_person` · `update_person` |
| `POST /api/v1/units/{id}/move-in` · `POST /api/v1/occupancies/{id}/move-out` | `move_in` · `move_out` |
| `POST /api/v1/units/{id}/replace-tenant` · `POST /api/v1/units/{id}/sell` | `replace_tenant` · `sell_unit` |
| `PATCH /api/v1/occupancies/{id}` | `correct_occupancy` |
| `PUT /api/v1/buildings/{id}/settlements/{YYYY-MM}` | `save_draft` (ítems por `concept_id` → monto string, con `detail` opcional) |
| `DELETE /api/v1/buildings/{id}/settlements/{YYYY-MM}` | `delete_draft` |
| `POST /api/v1/buildings/{id}/settlements/{YYYY-MM}/issue` | `issue_settlement` (devuelve el `IssueSummary` serializado) |
| `POST /api/v1/receipts/{id}/approve` (reparto corregido opcional) · `POST /api/v1/receipts/{id}/reject` (`reason`) | `approve_receipt` · `reject_receipt` |
| `POST /api/v1/occupancies/{id}/payments` | `record_manual_payment` (`amount`, `date`, `source`) |
| `POST /api/v1/occupancies/{id}/adjustments` | `adjust` (`entry_id` del asiento a corregir, que tiene que ser de esa ocupación; `amount`; `description`) |
| `POST /api/v1/occupancies/{id}/opening` | `record_opening` |
| `POST /api/v1/buildings/{id}/notices` | `publish_notice` |
| `POST /api/v1/claims/{id}/replies` · `PATCH /api/v1/claims/{id}` (`status`) | `reply_as_admin` · `set_claim_status` |
| `POST /api/v1/organizations/{org}/tasks` · `POST /api/v1/tasks/{id}/toggle` | `create_task` · `toggle_task` |

## Tests (`apps/api/tests/test_panel_write.py`) — primero los tests
1. **Por cada endpoint**, un caso feliz que verifique la respuesta **y** el efecto en la base (por ejemplo: aprobar → existen los `payment` y el comprobante está `approved`; emitir → existen los cargos y la liquidación está `issued`).
2. **Parametrizado sobre todas las rutas de escritura:** empleado de otra organización → 404 y **nada** cambia en la base; residente → 403; sin CSRF → 403.
3. Errores de dominio → 400 con el mensaje del servicio: emitir dos veces, aprobar un comprobante ya aprobado, vender con deuda (el mensaje dice el monto), monto con 3 decimales, monto como número JSON, ajuste sobre un asiento de **otra** ocupación (→ 404 o 400, nunca crea el ajuste).
4. Cada escritura deja **un** `AuditLog` con el empleado como actor.
5. **De punta a punta con la demo:** como María Fernández, aprobar el comprobante de María García (102 de Minas) por la API y después `GET portfolio`: `in_review` baja en ese monto, `collected` sube, y la cola tiene 3 comprobantes.

## Cómo verificar (pegalo en el reporte)
```bash
docker compose exec -T db dropdb -U postgres --if-exists test_propiedad_horizontal
docker compose run --rm web pytest -q -p no:cacheprovider
docker compose run --rm web python manage.py spectacular --validate --file /tmp/schema.yml
```
1. Primero la salida de los tests fallando (antes de implementar), después la suite completa en verde con el conteo total.
2. Cuántas rutas de escritura cubre el test parametrizado del punto 2.
3. El esquema valida sin errores ni advertencias.
