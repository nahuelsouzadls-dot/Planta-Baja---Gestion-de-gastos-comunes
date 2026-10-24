# Reporte: auditor — review-backend-b0-b4

## Hecho

### 1. Bypass de `settlementitem_no_issued_insert_update_delete` reasignando ítems de una liquidación emitida a un borrador
- **Gravedad:** crítica
- **Dónde:** `backend/apps/settlements/migrations/0002_immutable_issued.py:17-40`
- **Qué pasa:** La función de trigger `settlement_items_prevent_issued_change()` toma `settlement_id := OLD.settlement_id` únicamente cuando `TG_OP = 'DELETE'`; en `UPDATE` entra por el `ELSE` y evalúa solo `NEW.settlement_id` sin verificar `OLD.settlement_id`. Como resultado, cualquier `SettlementItem` perteneciente a una liquidación ya `issued` puede moverse mediante `UPDATE` (`QuerySet.update()` o SQL crudo) hacia una liquidación en estado `draft` y luego modificarse o borrarse sin que el trigger lo impida, vaciando o alterando el desglose histórico de una liquidación emitida (`settlement_total(issued)` pasa a `0.00`).
  - **Prueba ejecutada (`test_2_settlement_item_immutable_trigger_bypassed_by_moving_to_draft` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    issued = save_draft(building, date(2026, 10, 1), {concept: Decimal('1000.00')})
    issue_settlement(issued, user)
    item = issued.items.get()
    draft = save_draft(building, date(2026, 11, 1), {other_concept: Decimal('500.00')})

    SettlementItem.objects.filter(pk=item.pk).update(settlement=draft, amount=Decimal('1.00'))
    SettlementItem.objects.filter(pk=item.pk).delete()

    assert issued.items.count() == 0
    assert settlement_total(issued) == Decimal('0.00')
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_2
    .                                                                        [100%]
    1 passed in 2.25s
    ```
- **Sugerencia:** En `settlement_items_prevent_issued_change()`, cuando `TG_OP IN ('UPDATE', 'DELETE')` verificar primero el estado de `OLD.settlement_id` (y si es `'issued'`, hacer `RAISE EXCEPTION`), además de verificar `NEW.settlement_id` cuando `TG_OP IN ('INSERT', 'UPDATE')`. Agregar también `BEFORE TRUNCATE` sobre `settlements_settlement` y `settlements_settlementitem` igual que en `ledger_ledgerentry`.

---

### 2. Bypass del bloqueo de `django-axes` (fuerza bruta ilimitada en `/admin/login/` y colisión en `username=None`)
- **Gravedad:** alta
- **Dónde:** `backend/apps/accounts/axes.py:1-3`
- **Qué pasa:** `get_username(request, credentials)` solo inspecciona `credentials.get('email') or request.POST.get('email')`, ignorando `credentials.get('username')` y `request.POST.get('username')`. Sin embargo, `AuthenticationForm` / `AdminAuthenticationForm` de Django (usado en `/admin/login/`) publica el campo como `username` y llama a `authenticate(request, username=..., password=...)`, que `ModelBackend` resuelve contra `User.USERNAME_FIELD` (`email`). Esto provoca dos fallas reproducibles:
  1. **Fuerza bruta ilimitada desde la misma IP:** enviando en el POST a `/admin/login/` `'username': 'victim@example.com'` junto con un `'email': f'decoy-{i}@example.com'` rotativo, `ModelBackend` intenta autenticar a `victim@example.com` mientras `django-axes` contabiliza el fallo sobre `decoy-{i}@example.com`. Un atacante puede probar infinitas contraseñas desde la misma IP sin recibir nunca `429`.
  2. **Agrupación bajo `username=None`:** cuando no se envía `'email'` en el POST a `/admin/login/`, `get_username` devuelve `None`. Todos los intentos fallidos al admin desde una misma IP (por ejemplo, detrás de un NAT o proxy) se acumulan bajo `AccessAttempt(username=None, ip_address=...)`, y además un usuario bloqueado por API bajo su email puede esquivar ese bloqueo en `/admin/login/` enviando cualquier `'email'` distinto en el POST.
  - **Prueba ejecutada (`test_1_axes_unlimited_bruteforce_and_shared_null_username_on_admin_login` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    User.objects.create_superuser('victim@example.com', 'strong-password-123')
    for i in range(20):
        resp = client.post(
            reverse('admin:login'),
            {'username': 'victim@example.com', 'email': f'decoy-{i}@example.com', 'password': f'wrong-{i}'},
            REMOTE_ADDR='10.0.0.50',
        )
        assert resp.status_code == 200
    resp_ok = client.post(
        reverse('admin:login'),
        {'username': 'victim@example.com', 'email': 'decoy-final@example.com', 'password': 'strong-password-123'},
        REMOTE_ADDR='10.0.0.50',
    )
    assert resp_ok.status_code == 302
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_1
    .                                                                        [100%]
    1 passed in 2.34s
    ```
- **Sugerencia:** En `backend/apps/accounts/axes.py:1-3`, priorizar las credenciales efectivamente pasadas a `authenticate()` y contemplar tanto `email` como `username` (verificando además que sea `str` y que `request` no sea `None`):
  ```python
  def get_username(request, credentials):
      raw = (
          (credentials or {}).get('email')
          or (credentials or {}).get('username')
          or (request.POST.get('email') if request is not None else None)
          or (request.POST.get('username') if request is not None else None)
      )
      return raw.strip().lower() if isinstance(raw, str) and raw.strip() else None
  ```

---

### 3. `SettlementAdmin` permite pasar una liquidación a `issued` desde el Admin sin generar asientos en `LedgerEntry` (y produce HTTP 500 al crearla como `issued` con ítems)
- **Gravedad:** alta
- **Dónde:** `backend/apps/settlements/admin.py:10-39`
- **Qué pasa:** En `SettlementAdmin.get_readonly_fields(self, request, obj=None)`, cuando `obj is None` (alta) o `obj.status == Settlement.Status.DRAFT` (edición de borrador), devuelve `()`. Esto deja editables en el formulario del Admin los campos `status`, `issued_at` e `issued_by`.
  1. Si un usuario staff edita un borrador en el Admin y cambia `status='issued'` completando `issued_at` e `issued_by`, el `CheckConstraint` `settlement_status_issue_fields` pasa y la liquidación queda permanentemente bloqueada como `issued` (por el trigger de inmutabilidad) **sin haber pasado por `issue_settlement()`**, dejando **0 cargos en `LedgerEntry`** y salteándose `validate_coefficients()` y `owner_gaps()`.
  2. Si en `/admin/settlements/settlement/add/` se crea directamente con `status='issued'` y al menos un `SettlementItemInline`, Django inserta primero `Settlement` con `status='issued'` y al insertar el inline el trigger `settlementitem_no_issued_insert_update_delete` lanza `DatabaseError` no manejado (HTTP 500).
  - **Prueba ejecutada (`test_3_settlement_admin_allows_issuing_without_ledger_entries_and_500_on_add` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    resp = client.post(reverse('admin:settlements_settlement_change', args=[draft.pk]), {
        'building': str(building.pk), 'month': '2026-10-01', 'status': 'issued',
        'issued_at_0': '2026-10-01', 'issued_at_1': '12:00:00', 'issued_by': str(admin.pk), ...
    })
    assert resp.status_code == 302
    draft.refresh_from_db()
    assert draft.status == Settlement.Status.ISSUED
    assert LedgerEntry.objects.filter(settlement=draft).count() == 0
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_3
    .                                                                        [100%]
    1 passed in 2.31s
    ```
- **Sugerencia:** En `SettlementAdmin`, declarar `('status', 'issued_at', 'issued_by')` siempre dentro de `readonly_fields` (también en `add` y en `draft`), de modo que la transición a `issued` solo pueda ejecutarse mediante el servicio transaccional `issue_settlement()`.

---

### 4. Constraints de `LedgerEntry` aceptan combinaciones inválidas que luego son imposibles de borrar por el trigger append-only
- **Gravedad:** alta
- **Dónde:** `backend/apps/ledger/models.py:46-92`
- **Qué pasa:** La tabla `ledger_ledgerentry` es append-only, por lo que cualquier fila inválida que la base acepte no puede borrarse jamás. Actualmente la base acepta:
  1. **Valores arbitrarios en `kind`:** no hay `CheckConstraint(condition=Q(kind__in=LedgerEntry.Kind.values))`. Si se inserta un `kind` fuera del enum (por ejemplo `'recargo'`, `'ajuste'` en español o `'invalido'`), todas las restricciones `~Q(kind='charge')`, `~Q(kind='payment')`, `~Q(kind='surcharge')` y `~Q(kind='adjustment')` dan `TRUE` y se saltean por completo.
  2. **`days` no nulo con `days_in_month` nulo:** `ledger_days_in_month_range` es `days IS NULL OR (days >= 1 AND days <= days_in_month)`. En SQL, si `days = 999` y `days_in_month = NULL`, `999 <= NULL` evalúa a `UNKNOWN` (`NULL`), y un `CHECK` en PostgreSQL **aprueba** cuando la condición da `NULL`.
  3. **`base_amount` negativo y `coefficient` fuera de `(0, 1]` en asientos `charge`:** `ledger_charge_fields_valid` solo exige `IS NOT NULL`, permitiendo `base_amount = -9999.00` o `coefficient = 9.999999`.
  4. **Campos cruzados entre tipos de asiento:** `ledger_adjustment_target_required` solo valida `kind='adjustment' => adjusts IS NOT NULL`, pero permite que un `charge`, `payment` u `opening` tenga `adjusts` no nulo, o que un `payment`/`opening` tenga `settlement`, `concept`, `base_amount`, `coefficient`, `days` y `days_in_month`.
  - **Prueba ejecutada (`test_4_ledger_entry_constraints_accept_invalid_combinations` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    e1 = LedgerEntry.objects.create(
        occupancy=occ, date=date(2026, 10, 1), kind='invalido',
        amount=Decimal('-123.45'), days=999, days_in_month=None, created_by=user,
    )
    e2 = LedgerEntry.objects.create(
        occupancy=occ, date=date(2026, 10, 1), kind=LedgerEntry.Kind.CHARGE,
        amount=Decimal('100.00'), settlement=other_settlement, concept=other_concept,
        base_amount=Decimal('-9999.00'), coefficient=Decimal('9.999999'),
        days=31, days_in_month=31, adjusts=e1, created_by=user,
    )
    assert e1.pk is not None and e2.pk is not None
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_4
    .                                                                        [100%]
    1 passed in 2.15s
    ```
- **Sugerencia:** Agregar constraints en `LedgerEntry.Meta.constraints` para:
  - `Q(kind__in=LedgerEntry.Kind.values)`
  - En `charge`: `Q(base_amount__gt=0) & Q(coefficient__gt=0) & Q(coefficient__lte=1)` y en no-`charge`: `Q(settlement__isnull=True, concept__isnull=True, base_amount__isnull=True, coefficient__isnull=True, days__isnull=True, days_in_month__isnull=True)`
  - Equivalencia en `adjusts`: `(Q(kind='adjustment') & Q(adjusts__isnull=False)) | (~Q(kind='adjustment') & Q(adjusts__isnull=True))`
  - Paridad de nulidad entre `days` y `days_in_month`: `Q(days__isnull=True, days_in_month__isnull=True) | (Q(days__isnull=False, days_in_month__isnull=False) & Q(days__gte=1) & Q(days__lte=models.F('days_in_month')))`.

---

### 5. `days_in_month`, `occupancies_in_month` y `owner_gaps` calculan mal cuando `month.day != 1` (fin de mes / mitad de mes / bisiesto)
- **Gravedad:** media
- **Dónde:** `backend/apps/people/services.py:98-133`
- **Qué pasa:** Las tres funciones normalizan el final del mes usando `calendar.monthrange(month.year, month.month)[1]`, pero usan `month` directamente como inicio del mes en lugar de `date(month.year, month.month, 1)` (a diferencia de `save_draft` en `apps/settlements/services.py:50`, que normaliza con `first_day(month)`).
  - Si se consulta un año bisiesto pasando la fecha de fin de mes `date(2028, 2, 29)` sobre un propietario vigente todo el mes (`start_date=date(2028, 1, 1), end_date=None`), `days_in_month` devuelve `1` en vez de `29` y `owner_gaps` devuelve `28` días sin propietario.
  - Si una ocupación cerró el `2028-02-10` y se consulta con `date(2028, 2, 15)`, `days_in_month` devuelve `0` y `occupancies_in_month` la excluye por completo (`end_date__gte=month`).
  - **Prueba ejecutada (`test_6_days_in_month_and_owner_gaps_fail_when_month_day_is_not_1` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    assert days_in_month(occ, date(2028, 2, 1)) == 29
    assert days_in_month(occ, date(2028, 2, 29)) == 1
    assert owner_gaps(unit, date(2028, 2, 29)) == 28
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_6
    .                                                                        [100%]
    1 passed in 2.12s
    ```
- **Sugerencia:** Normalizar `month_start = date(month.year, month.month, 1)` al comienzo de `days_in_month()` y `occupancies_in_month()`, usando `month_start` en las comparaciones y filtros `end_date__gte=month_start`.

---

### 6. Montos `Decimal` con más de 2 decimales no se cuantizan con `ROUND_HALF_UP` en `save_draft`, `record_opening` ni `adjust`
- **Gravedad:** media
- **Dónde:** `backend/apps/settlements/services.py:53-106` y `backend/apps/ledger/services.py:11-15,44-75`
- **Qué pasa:**
  1. En `save_draft()`, si se pasa `Decimal('0.004')`, las validaciones `total <= 0` y `if amount > 0` evalúan `True` en Python, pero al hacer `bulk_create` PostgreSQL redondea `numeric(12,2)` a `0.00`. Queda guardado un `Settlement` en borrador con un `SettlementItem` de `amount = Decimal('0.00')` y `settlement_total = Decimal('0.00')`.
  2. En `apps/ledger/services.py`, `_ensure_decimal()` convierte a `Decimal` sin cuantizar a 2 decimales con `ROUND_HALF_UP`. Pasar `Decimal('0.004')` a `record_opening()` o `adjust()` supera `if amount == 0` en Python y falla en la base con `IntegrityError` (`ledger_entry_amount_nonzero`) en vez de devolver `None` o lanzar `ValidationError`; y pasar un monto con 3+ decimales delega el redondeo al cast implícito de Postgres en lugar de usar `quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)` en Python.
  - **Prueba ejecutada (`test_5_decimal_sub_cent_inputs_and_missing_quantize` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    settlement = save_draft(building, date(2026, 10, 1), {concept: Decimal('0.004')})
    assert settlement.items.get().amount == Decimal('0.00')
    assert settlement_total(settlement) == Decimal('0.00')

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            record_opening(occ, Decimal('0.004'), date(2026, 10, 1), user)
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_5
    .                                                                        [100%]
    1 passed in 2.18s
    ```
- **Sugerencia:** En `_ensure_decimal()` (`apps/ledger/services.py:11-14`) y al validar `items` en `save_draft()` (`apps/settlements/services.py:53`), rechazar exponentes con más de 2 decimales o cuantizar con `Decimal('0.01')` y `ROUND_HALF_UP` antes de evaluar `amount <= 0` / `amount == 0`.

---

### 7. `User.objects.create_user('   ', ...)` permite crear un usuario con `email=''`, y un `update()` con mayúsculas impide volver a iniciar sesión
- **Gravedad:** media
- **Dónde:** `backend/apps/accounts/models.py:12-25,38-58`
- **Qué pasa:**
  1. `UserManager._normalize_email()` evalúa `if not email:` antes de hacer `.strip()`. Si recibe solo espacios (`'   '`), no lanza `ValueError` y devuelve `''`, creando en la base un `User` con `email=''`.
  2. La columna `email` en `accounts_user` no tiene un `CheckConstraint` que prohíba `email = ''` ni que exija `email = LOWER(BTRIM(email))`. Si se actualiza el email por `QuerySet.update(email='Valid@Example.com')` o SQL directo, `get_by_natural_key()` busca `self.get(email=self._normalize_email(username))` con comparación exacta (`=`), por lo que el usuario no puede volver a autenticarse (`User.DoesNotExist`).
  - **Prueba ejecutada (`test_7_create_user_accepts_whitespace_only_email_and_update_breaks_login` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    u = User.objects.create_user('   ', 'strong-password-123')
    assert u.email == ''

    u2 = User.objects.create_user('valid@example.com', 'strong-password-123')
    User.objects.filter(pk=u2.pk).update(email='Valid@Example.com')
    with pytest.raises(User.DoesNotExist):
        User.objects.get_by_natural_key('valid@example.com')
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_7
    .                                                                        [100%]
    1 passed in 2.14s
    ```
- **Sugerencia:** En `_normalize_email()`, hacer `cleaned = self.normalize_email(email or '').strip().lower()` y verificar `if not cleaned: raise ValueError(...)`. Agregar en `User.Meta.constraints` un `CheckConstraint(condition=~Q(email='') & Q(email=Lower('email')), name='accounts_user_email_normalized')`.

---

### 8. `config/settings/production.py` importa `env` sin usarlo, acepta `SECRET_KEY='change-me'` y no define `CSRF_TRUSTED_ORIGINS`
- **Gravedad:** media
- **Dónde:** `backend/config/settings/production.py:1-21`
- **Qué pasa:** `production.py` hace `from .base import env` en la línea 2 pero nunca lo utiliza:
  1. No exige que `SECRET_KEY` y `ALLOWED_HOSTS` estén explícitamente definidos para producción ni rechaza el valor de ejemplo `SECRET_KEY='change-me'` de `.env.example`.
  2. Activa `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')` y `CSRF_COOKIE_SECURE = True`, pero no lee `CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])`.
  3. En el historial reciente (`git log -p -5 -- backend/.env.example docker-compose.yml`), el commit `ed928a4` contenía `SECRET_KEY=django-insecure-dev-key-change-in-production-abc123xyz456` y `DB_PASSWORD=postgres` (luego reemplazado por `SECRET_KEY=change-me` en `a88e039`; no se hallaron secretos reales de producción en el historial).
  - **Prueba ejecutada (`test_8_production_settings_accept_weak_secret_key_and_lack_csrf_trusted_origins` en `/tmp/agy-review/test_audit_findings.py`):**
    ```python
    monkeypatch.setenv('SECRET_KEY', 'change-me')
    importlib.reload(base_settings)
    importlib.reload(prod_settings)
    assert prod_settings.SECRET_KEY == 'change-me'
    assert getattr(prod_settings, 'CSRF_TRUSTED_ORIGINS', []) == []
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review -k test_8
    .                                                                        [100%]
    1 passed in 2.09s
    ```
- **Sugerencia:** En `config/settings/production.py`, requerir `SECRET_KEY = env('SECRET_KEY')` validando que tenga al menos 50 caracteres y sea distinto de `'change-me'`, requerir `ALLOWED_HOSTS = env.list('ALLOWED_HOSTS')` sin default local y definir `CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])`.

---

### 9. Cobertura débil o incompleta en tests existentes de B0, B3 y B4
- **Gravedad:** baja
- **Dónde:**
  - `backend/apps/accounts/tests/test_auth.py:26-40`
  - `backend/apps/settlements/tests/test_services.py:165-200`
  - `backend/apps/ledger/tests/test_ledger.py:180-188`
- **Qué pasa:**
  1. `test_axes_rejects_sixth_login_attempt_after_five_failures` (`test_auth.py:26-40`) construye un request sintético con `rf.post('/login/')` (ruta inexistente) y llama a `authenticate(request=request, email=...)`, sin probar ningún formulario o endpoint real de login (`/admin/login/` o `username=...`), razón por la cual pasó por alto el bug de `apps/accounts/axes.py`.
  2. `test_issued_settlement_and_items_are_immutable` (`test_services.py:179-181`) intenta `Settlement.objects.filter(pk=settlement.pk).update(status=Settlement.Status.DRAFT)` capturando `(DatabaseError, IntegrityError)` sin limpiar `issued_at`/`issued_by` ni probar la mutación de otro campo (p. ej. `month`), por lo que incluso sin el trigger de `Settlement` ese `update` habría fallado por el `CheckConstraint` `settlement_status_issue_fields`. Además, al final del test no verifica en la base que `item.amount` siga siendo `Decimal('100.00')` ni que `settlement.items.count()` siga siendo `1`.
  3. `test_admin_is_read_only` (`test_ledger.py:180-188`) solo hace `GET` a `admin:ledger_ledgerentry_add` y luego invoca `model_admin.has_*_permission(None)` con `request=None`, sin verificar una petición `POST` de cambio o borrado sobre un asiento existente.
- **Sugerencia:** Ajustar `test_issued_settlement_and_items_are_immutable` para capturar específicamente `DatabaseError`, probar la actualización de `month` y la reasignación de `SettlementItem.settlement`, y verificar al final del test que la fila y su monto permanecen intactos en la base.

## Cómo lo verifiqué
- Leí `docs/modelo-datos.md`, los ADRs en `docs/adr/` y `.github/copilot-instructions.md`.
- Revisé el historial de git con `git log -p -5 -- backend/.env.example docker-compose.yml` y `git ls-files`.
- Inspeccioné el código y las migraciones de B0–B4 (`apps/core`, `apps/accounts`, `apps/buildings`, `apps/people`, `apps/settlements`, `apps/ledger`, `config/settings/production.py` y `config/settings/development.py`), sin tocar ningún archivo del repositorio y dejando fuera `backend/apps/audit/` y `backend/config/settings/base.py`.
- Escribí la suite de reproducción en `/tmp/agy-review/test_audit_findings.py` (8 tests) y la ejecuté contra la base aislada `agy_review`:
  ```bash
  docker compose run --rm -e DB_NAME=agy_review -v /tmp/agy-review:/review web pytest -q -p no:cacheprovider /review
  ```
  Resultado: `8 passed in 2.60s`.

## Preguntas / pedidos al orquestador
- En `docker-compose.yml:27`, el servicio `web` publica `ports: - "8000:8000"` (`0.0.0.0:8000`) con `DEBUG=True` y `ALLOWED_HOSTS=['*']` en `development.py`, mientras que `db` ya fue restringido a `127.0.0.1:5434:5432` en B2. ¿Querés que el agente encargado ligue también `web` a `127.0.0.1:8000:8000`?

ESTADO: listo
