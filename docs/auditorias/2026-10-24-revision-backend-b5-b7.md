# Reporte: auditor — review-backend-b5-b7

## Hecho

### 1. Falta de control de pertenencia a la organización (`assert_member`) en `issue_settlement` (y ausencia de `user`/`audit_context` en `save_draft`, `delete_draft` y `create_person`)
- **Gravedad:** crítica
- **Dónde:** `backend/apps/settlements/services.py:193-210` (también `backend/apps/settlements/services.py:43-120` y `backend/apps/people/services.py:21-37`)
- **Qué pasa:** `issue_settlement(settlement, user)` únicamente verifica `if user is None: raise ValueError('issued_by es obligatorio.')` y nunca llama a `assert_member(user, locked.building.organization)`. Como resultado, un empleado perteneciente a otra organización (`OrgMembership` en Organización B) o cualquier usuario sin membresía alguna (por ejemplo, un residente) puede invocar `issue_settlement` sobre una liquidación de la Organización A, generando asientos definitivos en `LedgerEntry` y pasando la liquidación al estado inmutable `issued`. Además, `save_draft`, `delete_draft` y `create_person` no reciben `user`, por lo que ni verifican `assert_member` ni envuelven sus escrituras en `audit_context`.
  - **Prueba ejecutada (`test_1_issue_settlement_missing_org_membership_check` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    org_a, building_a = _setup_building_with_owner()
    org_b = Organization.objects.create(name='Org B')
    foreign_employee = User.objects.create_user('foreign@orgb.com', 'strong-pass-123')
    OrgMembership.objects.create(user=foreign_employee, organization=org_b)

    concept = building_a.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building_a, date(2026, 10, 1), {concept: Decimal('1000.00')})

    summary = issue_settlement(settlement, foreign_employee)
    settlement.refresh_from_db()
    assert settlement.status == Settlement.Status.ISSUED
    assert settlement.issued_by == foreign_employee
    assert LedgerEntry.objects.filter(settlement=settlement, created_by=foreign_employee).count() == 1
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_1
    .                                                                        [100%]
    1 passed in 2.21s
    ```
- **Sugerencia:** En `issue_settlement()`, llamar a `assert_member(user, locked.building.organization)` inmediatamente después de bloquear la fila (`select_for_update()`) y antes de validar estado o coeficientes. Exigir también `user` con `assert_member` y `audit_context` en `save_draft`, `delete_draft` y `create_person`.

---

### 2. `approve_receipt` valida membresía contra la organización de `ReceiptAllocation` en lugar de `receipt.person.organization` y, con `allocations=None`, no verifica titularidad ni suma contra `declared_amount`
- **Gravedad:** crítica
- **Dónde:** `backend/apps/ledger/payments.py:111-177`
- **Qué pasa:**
  1. En `approve_receipt`, `organization` se obtiene de `original_allocations[0].occupancy.unit.building.organization` (`líneas 120-126`) en vez de `locked.person.organization`, y nunca se comprueba `organization.id == locked.person.organization_id` (a diferencia de `reject_receipt`, que valida contra `locked.person.organization`). Si un comprobante cuya `person` pertenece a la Organización A tiene una `ReceiptAllocation` apuntando a una ocupación de la Organización B, un empleado de la Organización B pasa `assert_member(user, organization)` y aprueba el comprobante de la persona de A (mientras que un empleado de A recibe `PermissionDenied`).
  2. Cuando `allocations is None` (el camino por defecto en `líneas 130-131`), se omiten todas las validaciones de las líneas 136-149: no se verifica que `allocation.occupancy.person_id == locked.person_id`, ni que `allocation.occupancy.unit.building.organization_id == locked.person.organization_id`, ni que `sum(allocation.amount) == locked.declared_amount`. Si las imputaciones fueron modificadas o apuntan a otra ocupación/monto, `approve_receipt` inserta asientos `payment` en el libro mayor append-only por un total distinto a `declared_amount` o en la cuenta de otra persona/organización.
  3. Además, si un comprobante no tiene `ReceiptAllocation` (o mezcla dos organizaciones), las líneas 123-124 lanzan `ValidationError` antes de ejecutar `assert_member`, exponiendo el estado interno del comprobante a usuarios no autorizados en vez de rechazar con `PermissionDenied`.
  - **Prueba ejecutada (`test_2_approve_receipt_cross_org_and_unvalidated_default_allocations` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    receipt = submit_receipt(
        person_a, emp_a, file_key='receipts/cross-org', file_sha256='a' * 64,
        content_type='application/pdf', size_bytes=500,
        declared_amount=Decimal('5000.00'), transfer_date=date(2026, 10, 20),
        allocations={occ_a: Decimal('5000.00')},
    )
    ReceiptAllocation.objects.filter(receipt=receipt).update(
        occupancy=occ_b, amount=Decimal('100.00'),
    )

    with pytest.raises(PermissionDenied):
        approve_receipt(receipt, emp_a)

    entries = approve_receipt(receipt, emp_b)
    assert entries[0].occupancy == occ_b
    assert entries[0].amount == Decimal('-100.00')
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_2
    .                                                                        [100%]
    1 passed in 2.24s
    ```
- **Sugerencia:** En `approve_receipt`, tomar `organization = locked.person.organization` y ejecutar `assert_member(user, organization)` en primer lugar. Luego aplicar siempre las mismas validaciones tanto cuando `allocations is None` como cuando se pasa `allocations`: que haya al menos una imputación, que cada `occupancy.person_id == locked.person_id` y `occupancy.unit.building.organization_id == organization.id`, que haya `note` si son varias unidades y que la suma de importes coincida exactamente con `locked.declared_amount`.

---

### 3. `audit_context` borra `request_ip` y `request_path` cuando un servicio corre dentro de `AuditContextMiddleware`, deja `actor` y `organization` pegados en la transacción tras salir del `with`, y rompe el trigger con `DataError` si `actor.pk is None`
- **Gravedad:** alta
- **Dónde:** `backend/apps/audit/context.py:6-41`
- **Qué pasa:**
  1. **Pérdida de `request_ip` y `request_path` en todos los servicios llamados desde un request HTTP:** `AuditContextMiddleware` abre `with audit_context(actor=actor, ip=..., path=...):`. Cuando la vista invoca cualquier servicio de negocio (`issue_settlement`, `submit_receipt`, `approve_receipt`, `reject_receipt`, `record_manual_payment`, `move_in`, `move_out`, `replace_tenant`, `correct_occupancy`, `update_person`, `sell_unit`, `publish_notice`, `open_claim`, `reply_as_admin`, `reply_as_resident`, `set_claim_status`, `create_task`, `toggle_task`), el servicio abre un `with audit_context(user, organization=organization):` anidado con los defaults `ip=''` y `path=''`, ejecutando `set_config('app.request_ip', '', true)` y `set_config('app.request_path', '', true)`. Esto sobrescribe con `''` la IP y la ruta que había seteado el middleware, dejando `request_ip == ''` y `request_path == ''` en todos los `RowChange` producidos por los servicios.
  2. **Fuga de `actor` y `organization` tras salir de `with audit_context(...)` dentro de una transacción:** En PostgreSQL, `set_config(..., ..., true)` (`SET LOCAL`) dura hasta el final de la transacción SQL de nivel superior (`COMMIT`/`ROLLBACK`), y **no** se revierte al hacer `RELEASE SAVEPOINT` al salir de un `transaction.atomic()` anidado. Como `audit_context` no guarda ni restaura los valores previos en un bloque `finally:`, cualquier escritura posterior dentro de la misma transacción pero **fuera** del `with audit_context(emp_a, org_a):` hereda falsamente `actor = emp_a` y `organization_id = org_a.id` (incluso al escribir datos de otra organización o sin contexto).
  3. **`actor` sin PK (`AnonymousUser` o `User()` no guardado) hace explotar el trigger `audit_row_change()` con `DataError`:** En `apps/audit/context.py:9`, `str(actor.pk) if actor is not None else ''` evalúa a la cadena literal `'None'` cuando `actor` es `AnonymousUser()` (`actor is not None` pero `actor.pk is None`). Luego `NULLIF(current_setting('app.actor_id', true), '')::uuid` en `audit_row_change()` intenta convertir `'None'::uuid` y falla con `DataError: invalid input syntax for type uuid: "None"`.
  - **Prueba ejecutada (`test_3_audit_context_wipes_request_ip_path_and_leaks_actor_in_transaction` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    request = rf.post('/api/buildings/notices/', REMOTE_ADDR='203.0.113.55')
    request.user = emp_a
    AuditContextMiddleware( lambda req: publish_notice(building_a, req.user, 'Corte', 'Texto largo de aviso.') )(request)

    notice_change = RowChange.objects.get(table_name='communications_notice', operation=RowChange.Operation.INSERT)
    assert notice_change.request_ip == ''
    assert notice_change.request_path == ''

    with transaction.atomic():
        with audit_context(emp_a, organization=org_a, ip='198.51.100.1', path='/interno'):
            pass
        leaked_person = create_person(org_b, first_name='Sin', last_name='Contexto')

    leaked_change = RowChange.objects.get(table_name='people_person', row_id=leaked_person.id)
    assert leaked_change.actor == emp_a
    assert leaked_change.organization_id == org_a.id
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_3
    .                                                                        [100%]
    1 passed in 2.18s
    ```
- **Sugerencia:** En `audit_context`:
  1. Verificar `getattr(actor, 'pk', None) is not None` antes de convertir `actor.pk` a `str`.
  2. Antes de llamar a `set_config`, leer los 4 valores actuales con `current_setting(..., true)`; si `ip` o `path` (u `organization`) no se especificaron (`None`), conservar el valor ya presente en la transacción en lugar de pisarlo con `''`; y en un bloque `try ... finally:`, restaurar los 4 valores anteriores al salir del `with`.

---

### 4. Imputación FIFO (`periods`, `account_status`, `overdue_months`) aplica los asientos `adjustment` al `credit_pool` global o al mes de hoy en lugar del asiento que corrigen (`adjusts`), y `account_status` devuelve `'sin-cargar'` ocultando deuda vigente
- **Gravedad:** alta
- **Dónde:** `backend/apps/ledger/accounts.py:24-84` y `backend/apps/ledger/services.py:60-75`
- **Qué pasa:**
  1. **Un ajuste negativo para anular un cargo nuevo da por pagada una deuda vieja (`moroso` pasa a `pendiente`):** En `periods()` (`apps/ledger/accounts.py:37-42`), un asiento `adjustment` con `amount < 0` se suma al `credit_pool` global (`credit_pool -= entry.amount`) en lugar de restarse del mes del asiento referenciado en `entry.adjusts`. Si una ocupación debe agosto (`$1000.00` impago) y en octubre se le carga por error un concepto de `$1000.00` que luego se anula con `adjust(cargo_octubre, Decimal('-1000.00'), ...)`, FIFO consume esos `-$1000.00` contra **agosto** (dejando agosto con `outstanding = 0.00` y octubre con `outstanding = 1000.00`). En consecuencia, en octubre `overdue_months(occ, date(2026, 10, 1))` devuelve `[]` y `account_status` cambia de `'moroso'` a `'pendiente'` aunque la deuda de agosto jamás se pagó.
  2. **Un ajuste positivo para revertir un pago erróneo mantiene cubierto el mes viejo y traslada la deuda a hoy:** `adjust()` (`apps/ledger/services.py:69`) usa `date=timezone.localdate()`. Si se revierte con un `adjustment` positivo (`+$1000.00`) un pago mal acreditado en agosto, `periods()` mantiene los `$1000.00` del pago original en `credit_pool` (cubriendo agosto) y agrega `+$1000.00` como cargo del mes actual (`_month(entry.date)`), duplicando `charged` y quitando al deudor del estado `'moroso'`.
  3. **`account_status` devuelve `'sin-cargar'` cuando la ocupación tiene deuda positiva (`opening` o `surcharge`) en el mes actual pero aún no se emitió la liquidación mensual:** En `apps/ledger/accounts.py:71-78`, la condición `if not occupancy.unit.building.settlements.filter(month=_month(current_month), status='issued').exists(): return 'sin-cargar'` se evalúa **antes** de `if sum(period.outstanding ...) > 0: return 'pendiente'`, contradiciendo `docs/modelo-datos.md` §5 ("si no, `moroso` si tiene meses anteriores al mes en curso sin cubrir; si no, `pendiente` si tiene saldo > 0; si no, `pagado`").
  - **Prueba ejecutada (`test_4_fifo_adjustments_misapplied_and_sin_cargar_hides_current_debt` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    s_aug = save_draft(building, date(2026, 8, 1), {concept: Decimal('1000.00')})
    issue_settlement(s_aug, emp)
    s_oct = save_draft(building, date(2026, 10, 1), {concept: Decimal('1000.00')})
    issue_settlement(s_oct, emp)
    charge_oct = LedgerEntry.objects.get(settlement=s_oct, occupancy=occ)

    adjust(charge_oct, Decimal('-1000.00'), 'Anula cargo de octubre por error', emp)

    per = {p.month: p for p in periods(occ)}
    assert per[date(2026, 8, 1)].outstanding == Decimal('0.00')
    assert per[date(2026, 10, 1)].outstanding == Decimal('1000.00')
    assert overdue_months(occ, date(2026, 10, 1)) == []
    assert account_status(occ, date(2026, 10, 1)) == 'pendiente'

    record_opening(occ2, Decimal('500.00'), date(2026, 11, 1), emp)
    assert account_status(occ2, date(2026, 11, 1)) == 'sin-cargar'
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_4
    .                                                                        [100%]
    1 passed in 2.26s
    ```
- **Sugerencia:** En `periods()`, resolver los asientos `adjustment` contra el asiento al que apuntan (`entry.adjusts`): si ajusta un cargo (`charge`, `opening > 0`, `surcharge`), impactar el monto en el mes de ese cargo (acotando en 0 y volcando solo un eventual excedente negativo a `credit_pool`); si ajusta un haber (`payment` o `opening < 0`), ajustar `credit_pool`. En `account_status()`, evaluar `if sum(period.outstanding ...) > 0: return 'pendiente'` antes de devolver `'sin-cargar'`.

---

### 5. `issue_settlement` aborta con `RuntimeError` cuando la diferencia de redondeo negativa alcanza o supera la parte mayor (`target['amount'] + difference <= 0`)
- **Gravedad:** media
- **Dónde:** `backend/apps/settlements/services.py:258-299`
- **Qué pasa:** Cuando varias partes de un concepto redondean hacia arriba por medio centavo (`0.005 -> 0.01` con `ROUND_HALF_UP`), `difference = item.amount - distributed` es negativo. En las líneas 265-273, `issue_settlement` aplica toda la `difference` a un único candidato (`target['amount'] += difference`). Si `target['amount'] + difference < 0` (por ejemplo, en un edificio de 16 unidades de coeficiente `0.062500` como Pocitos con un concepto de `$0.08`, donde cada unidad redondea de `0.005` a `0.01`, `distributed = 0.16`, `difference = -0.08` y `target['amount'] = 0.01 - 0.08 = -0.07`), el filtro de la línea 276 (`if candidate['amount'] <= 0: continue`) descarta a `target` junto con el ajuste negativo. La suma de los asientos restantes queda en `$0.15 != $0.08` y `issue_settlement` lanza `RuntimeError('La suma de los cargos creados no coincide con el total de la liquidación.')`.
  - **Prueba ejecutada (`test_5_issue_settlement_negative_rounding_difference_crashes_with_runtime_error` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    org, building = _setup_building_with_owner(coefficients=tuple(['0.062500'] * 16))
    emp = User.objects.create_user('emp@round.com', 'strong-pass-123')
    OrgMembership.objects.create(user=emp, organization=org)
    concept = building.concepts.get(name='O.S.E. (agua)')

    settlement = save_draft(building, date(2026, 10, 1), {concept: Decimal('0.08')})
    with pytest.raises(RuntimeError, match='no coincide con el total'):
        issue_settlement(settlement, emp)
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_5
    .                                                                        [100%]
    1 passed in 2.21s
    ```
- **Sugerencia:** Cuando `difference < 0` y `-difference > target['amount']`, repartir la reducción centavo a centavo entre los candidatos con `amount > 0` ordenados por la misma clave de prioridad (sin bajar ninguno de `Decimal('0.00')`), de modo que la suma distribuida coincida siempre exactamente con `item.amount`. Asimismo, cuando `candidate['amount'] > 0` pero `_round_money(candidate['base']) == Decimal('0.00')` (coeficiente muy chico que recibe el ajuste de redondeo), asegurar que `base_amount` sea al menos `Decimal('0.01')` para cumplir la restricción de `base_amount > 0`.

---

### 6. `replace_tenant` y `sell_unit` lanzan `IntegrityError` no manejado al ejecutarse dos veces en la misma fecha (o el día de inicio), `sell_unit` permite vender al mismo propietario actual, y `move_in` acepta cualquier string como `role`
- **Gravedad:** media
- **Dónde:** `backend/apps/people/services.py:40-184, 263-296` y `backend/apps/people/models.py:59-101`
- **Qué pasa:**
  1. **Cambio de inquilino o venta dos veces seguidas en la misma fecha (o en `start_date`) lanza `IntegrityError`:** En `replace_tenant` (`línea 118`: `current.end_date = change_date - timedelta(days=1)`) y en `sell_unit` (`línea 289`: `seller_occupancy.end_date = sale_date - timedelta(days=1)`), si `change_date == current.start_date` o `sale_date == seller_occupancy.start_date`, `end_date` queda un día antes de `start_date` y `save()` viola el `CheckConstraint` `occupancy_end_after_start` lanzando `IntegrityError` no manejado. En `correct_occupancy` (`líneas 169-182`) ocurre lo mismo cuando se corrige una ocupación dejando `end_date < start_date`, y en `update_person` (`línea 205`) cuando el `email` colisiona con otra persona de la misma organización (`person_email_unique_per_org`).
  2. **`sell_unit` no rechaza vender la unidad al mismo propietario actual (`buyer == seller_occupancy.person`) ni captura superposiciones futuras:** A diferencia de `replace_tenant` (que verifica `if current.person_id == new_person.id`), `sell_unit` permite venderle la unidad al mismo dueño actual (cerrando su ocupación y abriendo otra idéntica para la misma persona), y no envuelve `Occupancy.objects.create` en `try/except IntegrityError` cuando existe una ocupación posterior a `sale_date`.
  3. **`Occupancy` y `move_in` aceptan roles arbitrarios:** `Occupancy` no tiene `CheckConstraint(condition=Q(role__in=Occupancy.Role.values))` y `move_in` no valida `role`, permitiendo insertar ocupaciones con `role='intruso'` (que luego son ignoradas por `issue_settlement` y `owner_gaps`).
  - **Prueba ejecutada (`test_6_replace_tenant_and_sell_unit_same_day_crash_and_duplicate_owner` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    replace_tenant(unit, t1, date(2026, 3, 15), emp)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            replace_tenant(unit, t2, date(2026, 3, 15), emp)

    current_owner = unit.occupancies.get(role=Occupancy.Role.OWNER).person
    dup_owner_occ = sell_unit(unit, current_owner, date(2026, 3, 15), emp)
    assert unit.occupancies.filter(role=Occupancy.Role.OWNER, person=current_owner).count() == 2

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            sell_unit(unit, t3, date(2026, 3, 15), emp)

    weird_occ = move_in(unit, t2, 'intruso', date(2026, 4, 1), emp)
    assert weird_occ.role == 'intruso'
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_6
    .                                                                        [100%]
    1 passed in 2.22s
    ```
- **Sugerencia:**
  - En `replace_tenant` y `sell_unit`, validar que `change_date > current.start_date` / `sale_date > seller_occupancy.start_date` (y que la ocupación que se cierra sea la vigente `end_date is None`), rechazando con `ValidationError` si la fecha es `<= start_date` (indicando usar `correct_occupancy` si no tiene movimientos).
  - En `sell_unit`, validar `if seller_occupancy.person_id == buyer.id: raise ValidationError(...)` y capturar `IntegrityError` (`occupancy_no_overlap`).
  - En `Occupancy.Meta.constraints`, agregar `CheckConstraint(condition=Q(role__in=Occupancy.Role.values), name='occupancy_role_valid')` y validar `role in Occupancy.Role.values` en `move_in`.

---

### 7. Ex inquilino puede responder reclamos tras su salida (`reply_as_resident`), comparación `person.user_id != user.id` falla cuando ambos son `None`, y montos con 3+ decimales en `submit_receipt`/`approve_receipt` desincronizan el libro mayor
- **Gravedad:** media
- **Dónde:** `backend/apps/communications/services.py:126-172` y `backend/apps/ledger/payments.py:17-22, 42-177`
- **Qué pasa:**
  1. **Ex inquilino sigue respondiendo reclamos después de mudarse (`reply_as_resident`) y puede subir comprobantes con saldo 0 (`submit_receipt`):** A diferencia de `open_claim` (`línea 131`), `reply_as_resident` (`líneas 155-172`) nunca verifica `_current_occupancy(person, locked_claim.unit, timezone.localdate())`. Un ex inquilino cuya ocupación ya finalizó (`end_date < hoy`) puede seguir enviando mensajes en reclamos del edificio posteriores a su salida, incumpliendo N17 (`docs/modelo-datos.md`). Del mismo modo, `submit_receipt` permite que un residente con ocupación cerrada y `balance(occupancy) <= 0` siga subiendo comprobantes.
  2. **Bypass de `person.user_id != user.id` cuando ambos son `None`:** En `submit_receipt` (`línea 56`), `open_claim` (`línea 127`) y `reply_as_resident` (`línea 159`), si `person` no tiene cuenta (`person.user_id is None`, caso válido según N7) y `user` es `AnonymousUser()` (`user.id is None`), `person.user_id != user.id` evalúa `None != None` (`False`), salteando el `PermissionDenied` y fallando recién en la base con `DataError` (`invalid input syntax for type uuid: "None"`).
  3. **Desincronización entre `Receipt.declared_amount` y la suma de `LedgerEntry` `payment` con decimales sub-centavo:** `_decimal()` en `apps/ledger/payments.py:17-22` no rechaza ni cuantiza exponentes con más de 2 decimales. Si en `submit_receipt` o `approve_receipt` se envía `declared_amount=Decimal('10.00')` con `allocations={occ1: Decimal('3.334'), occ2: Decimal('3.334'), occ3: Decimal('3.332')}`, la validación `sum == declared_amount` pasa en Python (`10.000 == 10.00`), pero PostgreSQL redondea cada `ReceiptAllocation` y cada `LedgerEntry` a `3.33`, dejando un comprobante aprobado de `$10.00` cuyos pagos en el libro mayor suman **`-$9.99`**.
  - **Prueba ejecutada (`test_7_ex_tenant_can_reply_claims_and_null_user_id_bypass_and_subcent_payments` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    occ.end_date = timezone.localdate() - timedelta(days=1)
    occ.save(update_fields=['end_date', 'updated_at'])
    msg = reply_as_resident(claim, ex_person, ex_user, 'Sigo comentando aunque ya no vivo acá.')
    assert msg.pk is not None

    with pytest.raises(DataError, match='invalid input syntax for type uuid: "None"'):
        with transaction.atomic():
            open_claim(person_no_account, unit, Claim.Kind.REPORT, 'Fuga', 'Detalle', AnonymousUser())

    receipt = submit_receipt(
        person_no_account, emp, file_key='receipts/subcent-mismatch', file_sha256='b' * 64,
        content_type='application/pdf', size_bytes=100, declared_amount=Decimal('10.00'),
        transfer_date=date(2026, 10, 20),
        allocations={occ1: Decimal('3.334'), occ2: Decimal('3.334'), occ3: Decimal('3.332')},
        note='Tres unidades',
    )
    entries = approve_receipt(receipt, emp)
    assert sum((-e.amount for e in entries), Decimal('0.00')) == Decimal('9.99')
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_7
    .                                                                        [100%]
    1 passed in 2.29s
    ```
- **Sugerencia:**
  - En `open_claim`, `reply_as_resident` y `submit_receipt`, exigir `user is not None and user.is_authenticated and getattr(user, 'pk', None) is not None and person.user_id == user.id`.
  - En `reply_as_resident`, verificar `_current_occupancy(person, locked_claim.unit, timezone.localdate())`. En `submit_receipt`, cuando quien sube es el residente, verificar que cada ocupación esté vigente o tenga `balance(occupancy) > 0` (N17).
  - En `_decimal()` (`apps/ledger/payments.py:17-22`), cuantizar con `ROUND_HALF_UP` a `Decimal('0.01')` (o rechazar `value.as_tuple().exponent < -2`) antes de validar `> 0` y la suma contra `declared_amount`.

---

### 8. `TRUNCATE` sobre tablas de negocio borra filas sin dejar registro en `audit_rowchange`, y debilidades en tests existentes de B4b, B5, B6b y B7
- **Gravedad:** baja
- **Dónde:**
  - `backend/apps/audit/operations.py:4-19`
  - `backend/apps/settlements/tests/test_issue.py:56-59`
  - `backend/apps/ledger/tests/test_accounts.py:97-117`
  - `backend/apps/audit/tests/test_audit.py:215-241`
  - `backend/apps/communications/tests/test_services.py:176-200`
- **Qué pasa:**
  1. `AuditTrigger` (`apps/audit/operations.py:13-17`) solo crea un trigger `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW`. En PostgreSQL, `TRUNCATE` es una operación a nivel de tabla y no dispara triggers `FOR EACH ROW`; en tablas que no tienen trigger `BEFORE TRUNCATE` (como `communications_notice`, `communications_task`, `ledger_receiptallocation`, etc.), un `TRUNCATE` elimina todas las filas dejando **0 registros en `audit_rowchange`**.
  2. **Debilidades en los tests existentes:**
     - `test_issue.py:56-59`: el fixture `user` crea un `User` sin ningún `OrgMembership` y lo usa para emitir todas las liquidaciones, razón por la cual ningún test detectó que `issue_settlement` no llama a `assert_member`.
     - `test_accounts.py:97-117` (`test_account_status_pendiente`): inserta manualmente un `Settlement(status='issued')` vacío (0 ítems y 0 cargos) antes de crear un `SURCHARGE` para que `account_status` devuelva `'pendiente'`, ocultando el bug del hallazgo #4 (sin ese `Settlement` artificial devuelve `'sin-cargar'`).
     - `test_audit.py:217-222` (`test_rowchange_is_append_only`): hace `change = RowChange.objects.get(...)` y en la línea siguiente lo sobrescribe con `change = RowChange.objects.first()`, y al final del test no verifica que la fila permanezca sin cambios en la base.
     - `test_services.py:176-200` (`test_communications_tables_have_audit_triggers`): instancia `BuildingFactory()`, `ClaimFactory()` y `TaskFactory()` sin usar las variables ni verificar los `RowChange` generados.
  - **Prueba ejecutada (`test_8_truncate_business_tables_leaves_zero_audit_rowchange` en `/tmp/agy-review2/test_audit_b5_b7.py`):**
    ```python
    notice = publish_notice(building, emp, 'Aviso importante', 'Cuerpo del aviso importante.')
    with connection.cursor() as cursor:
        cursor.execute('SET CONSTRAINTS ALL IMMEDIATE')
        cursor.execute('TRUNCATE communications_notice')

    assert Notice.objects.count() == 0
    assert not RowChange.objects.filter(
        table_name='communications_notice', operation=RowChange.Operation.DELETE,
    ).exists()
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review2 -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review web pytest -q -p no:cacheprovider /review -k test_8
    .                                                                        [100%]
    1 passed in 2.25s
    ```
- **Sugerencia:** Bloquear `BEFORE TRUNCATE` en las tablas auditadas (o registrar un evento a nivel `FOR EACH STATEMENT` en `TRUNCATE`) y corregir los tests señalados en `test_issue.py`, `test_accounts.py`, `test_audit.py` y `test_services.py`.

## Cómo lo verifiqué
- Extraí una copia congelada del commit `b573653` en `/tmp/agy-src` sin tocar ningún archivo del repositorio (`backend/`, `docs/` ni git).
- Leí `docs/modelo-datos.md` (§1 y §5), `.github/copilot-instructions.md` y los ADRs `0006`, `0008`, `0009`, `0011`, `0015` y `0016`.
- Inspeccioné el código y las migraciones de B2b, B4b, B5, B6a, B6b y B7 (`apps/settlements`, `apps/ledger`, `apps/people`, `apps/communications`, `apps/audit`).
- Ejecuté la suite existente (116 tests) y luego escribí y corrí la suite de reproducción en `/tmp/agy-review2/test_audit_b5_b7.py` (8 tests) contra la base aislada `agy_review2`:
  ```bash
  docker compose run --rm -e DB_NAME=agy_review2 \
    -v /tmp/agy-src/backend:/app -v /tmp/agy-review2:/review \
    web pytest -q -p no:cacheprovider /review
  ```
  Resultado: `8 passed in 3.11s`.

## Preguntas / pedidos al orquestador
- En `docs/modelo-datos.md` D9 se indica que la diferencia de redondeo va a "la unidad de mayor coeficiente", mientras que en §5 y `ADR-0011` se indica que se suma a "la parte más grande del edificio" (y `issue_settlement` ordena por `-candidate['amount']`). Cuando la unidad de mayor coeficiente tiene una mudanza a mitad de mes, sus dos partes individuales pueden ser menores que la parte de otra unidad de menor coeficiente sin mudanza. ¿Querés que el desempate del redondeo priorice `-candidate['amount']` (como hace hoy) o `-candidate['unit'].coefficient`?

ESTADO: listo
