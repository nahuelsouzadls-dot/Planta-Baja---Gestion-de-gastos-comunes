# Reporte: auditor — review-api-c1-c2

## Hecho

### Parte A — Ajuste de la CI (`.github/workflows/ci.yml`)

- Se actualizaron `actions/checkout` (de `@v4` a `@v7`, última versión mayor vigente; `action.yml` con `runs.using: node24`, release actual `v7.0.1`) y `actions/setup-python` (de `@v5` a `@v7`, última versión mayor vigente; `action.yml` con `runs.using: 'node24'`, release actual `v7.1.0`), manteniendo `permissions`, `concurrency` y el resto del workflow sin cambios.

Diff aplicado en `.github/workflows/ci.yml`:
```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 73a9724..b52f714 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -51,10 +51,10 @@ jobs:
 
     steps:
       - name: Checkout del repositorio
-        uses: actions/checkout@v4
+        uses: actions/checkout@v7
 
       - name: Configurar Python 3.12
-        uses: actions/setup-python@v5
+        uses: actions/setup-python@v7
         with:
           python-version: "3.12"
           cache: pip
```

Validación del YAML:
```text
$ ruby -ryaml -e "data = YAML.safe_load(File.read('.github/workflows/ci.yml')); puts 'YAML OK: ' + data['jobs']['backend']['steps'].slice(0, 2).map { |s| s['uses'] }.join(', ')"
YAML OK: actions/checkout@v7, actions/setup-python@v7
```

---

### Parte B — Revisión de seguridad de la API (C1 y C2 sobre el commit `540a194`)

Las reproducciones quedaron en `/tmp/agy-review3/test_audit_c1_c2.py`.

---

#### 1. Secuestro de cuenta de residente (`person.user`) al aceptar una invitación previa cuyo email ya no coincide con `person.email`
- **Gravedad:** crítica
- **Dónde:** `backend/apps/accounts/invitations.py:61-65`, `backend/apps/accounts/invitations.py:129-136` (en interacción con `backend/apps/people/services.py:257-286`)
- **Qué pasa:**
  1. Mientras una invitación de residente está pendiente (`person.user_id is None`), `update_person` permite modificar `person.email` (por ejemplo, cuando la administración corrige un email mal cargado de `'equivocado@example.com'` a `'lucia.real@example.com'`) sin revocar las invitaciones pendientes de esa `Person`.
  2. Cuando la administración reenvía la invitación llamando a `invite_resident(person, admin)` con el email corregido, `_create_invitation` (`invitations.py:61-65`) revoca invitaciones filtrando únicamente por `Invitation.objects.filter(organization=organization, email=email, ...)` y **no** por `person=person`. Por lo tanto, la invitación anterior enviada a `'equivocado@example.com'` permanece activa (`revoked_at is None`, `used_at is None`).
  3. En `accept_invitation` (`invitations.py:129-136`), el bloque `else:` (residente) solo verifica `if person.user_id and person.user_id != user.pk:` y **nunca comprueba `person.email == invitation.email`** (ni que `person.email` siga siendo no vacío, ni que `person.organization_id == invitation.organization_id`).
  4. Como resultado, el destinatario del email viejo (`'equivocado@example.com'`) puede aceptar su token, crear o usar su `User(email='equivocado@example.com')` y quedar vinculado como `person.user` de la `Person` cuyo email actual es `'lucia.real@example.com'`, tomando acceso al portal de sus unidades y bloqueando a la verdadera residente cuando intenta aceptar su invitación nueva (`person.user_id != user.pk`).
  - **Prueba ejecutada (`test_1_resident_invitation_accepts_stale_email_and_hijacks_person` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    person = Person.objects.create(
        organization=org, first_name='Lucía', last_name='Gómez', email='equivocado@example.com',
    )
    inv_old, token_old = invite_resident(person, admin)

    person = update_person(person, admin, email='lucia.real@example.com')
    inv_new, token_new = invite_resident(person, admin)

    inv_old.refresh_from_db()
    assert inv_old.revoked_at is None

    attacker_user = accept_invitation(token_old, PASSWORD)
    person.refresh_from_db()
    assert person.email == 'lucia.real@example.com'
    assert attacker_user.email == 'equivocado@example.com'
    assert person.user_id == attacker_user.pk

    with pytest.raises(ValidationError, match='El link no es válido o venció'):
        accept_invitation(token_new, PASSWORD)
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_1
    .                                                                        [100%]
    1 passed in 2.34s
    ```
- **Sugerencia:**
  1. En `_create_invitation` (`invitations.py:61-65`), al revocar invitaciones previas de `Kind.RESIDENT`, filtrar por `Q(email=email) | Q(person=person)` dentro de la organización (y acotar por `kind=kind` para no revocar cruzadamente invitaciones de distinto tipo); y en `update_person`, si cambia `person.email`, revocar las invitaciones pendientes de `person`.
  2. En `accept_invitation` (`invitations.py:130-136`), tras `person = Person.objects.select_for_update().get(pk=invitation.person_id)`, verificar `if not person.email or person.email != invitation.email or person.organization_id != invitation.organization_id: raise ValidationError(INVALID_INVITATION)`.
  3. En `invite_resident` (`invitations.py:94-97`), pasar también `first_name=person.first_name, last_name=person.last_name` a `_create_invitation` para que el `User` creado al aceptar no quede con nombre y apellido vacíos si el request no los envía.

---

#### 2. Evasión total de `ScopedRateThrottle` con `X-Forwarded-For` y bloqueo cruzado / evasión en `django-axes` detrás del proxy de Railway
- **Gravedad:** alta
- **Dónde:** `backend/config/settings/base.py:127-131`, `backend/config/settings/base.py:146-154`, `backend/config/settings/production.py:18-33` y `backend/apps/api/v1/auth.py:42-43, 131-132, 149-150, 159-160`
- **Qué pasa:**
  1. **`ScopedRateThrottle` confía ciegamente en `X-Forwarded-For` (`NUM_PROXIES` no configurado):** En `REST_FRAMEWORK` no se define `'NUM_PROXIES'`. Cuando `NUM_PROXIES` es `None`, `BaseThrottle.get_ident(request)` de DRF ejecuta `''.join(xff.split()) if xff else remote_addr`. Incluso detrás del proxy de Railway (que añade la IP real al final de la cabecera, formando `<ip_falsa>, <ip_real>`), toda la cadena se usa como clave de caché. Basta con que el cliente varíe `X-Forwarded-For` en cada request para esquivar por completo los límites de `login` (`10/min`), `invitation_accept` (`10/hour`), `password_reset` (`5/hour`) y `password_reset/confirm` (`5/hour`).
  2. **Desalineación de IP en `django-axes` detrás de Railway:** `django-axes` no tiene configurado `AXES_IPWARE_PROXY_COUNT` ni `AXES_IPWARE_META_PRECEDENCE_ORDER`, por lo que toma únicamente `REMOTE_ADDR` (que detrás de Railway es la IP interna del proxy compartida por todos los clientes). Combinado con `AXES_LOCKOUT_PARAMETERS = [['username', 'ip_address']]`:
     - Un atacante que falle 5 veces con el email de una víctima bloquea a la víctima legítima (`429`) porque ambos comparten la `REMOTE_ADDR` del proxy.
     - Al mismo tiempo, como el bloqueo es sobre el par `['username', 'ip_address']` y el throttle de DRF se evade con `X-Forwarded-For`, un atacante puede probar hasta 4 contraseñas por cuenta contra una lista ilimitada de emails sin ser bloqueado ni por `axes` ni por DRF.
  3. **Caché de throttling en memoria local por worker (`LocMemCache`):** Ni `base.py` ni `production.py` configuran `CACHES` (contra Redis), por lo que `ScopedRateThrottle` usa `LocMemCache` aislado en cada proceso worker de Gunicorn (`GUNICORN_WORKERS=2`).
  - **Prueba ejecutada (`test_2_throttle_bypass_via_x_forwarded_for_and_axes_shared_proxy_ip` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    for i in range(12):
        res = client.post(
            '/api/v1/auth/password-reset', {'email': f'user{i}@example.com'},
            format='json', REMOTE_ADDR='10.0.0.1',
            HTTP_X_FORWARDED_FOR=f'203.0.113.{i}, 198.51.100.77',
        )
        assert res.status_code == 204

    victim = User.objects.create_user('victim@example.com', PASSWORD)
    for i in range(15):
        res = client.post(
            '/api/v1/auth/login', {'email': f'probe-{i}@example.com', 'password': 'wrong-password'},
            format='json', REMOTE_ADDR='10.0.0.2', HTTP_X_FORWARDED_FOR=f'192.0.2.{i}',
        )
        assert res.status_code == 400

    for i in range(5):
        client.post(
            '/api/v1/auth/login', {'email': victim.email, 'password': 'wrong-password'},
            format='json', REMOTE_ADDR='10.0.0.2', HTTP_X_FORWARDED_FOR=f'198.18.0.{i}',
        )

    legit_res = client.post(
        '/api/v1/auth/login', {'email': victim.email, 'password': PASSWORD},
        format='json', REMOTE_ADDR='10.0.0.2', HTTP_X_FORWARDED_FOR='198.51.100.200',
    )
    assert legit_res.status_code == 429
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_2
    .                                                                        [100%]
    1 passed in 3.75s
    ```
- **Sugerencia:**
  1. Configurar `REST_FRAMEWORK['NUM_PROXIES'] = 1` en producción (o extraer la IP real desde el último salto confiable de `X-Forwarded-For` tanto para DRF como para `django-axes` y `AuditContextMiddleware`).
  2. Configurar `django-axes` de forma consistente con el proxy de Railway (`AXES_IPWARE_META_PRECEDENCE_ORDER = ['HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR']` tomando el salto del proxy confiable / `AXES_IPWARE_PROXY_COUNT = 1`).
  3. Separar los scopes de throttle de `PasswordResetView` y `PasswordResetConfirmView`, y respaldar `CACHES` en Redis en producción para compartir contadores entre workers de Gunicorn.

---

#### 3. Fuerza bruta sin `django-axes`, inicio de sesión de usuarios inactivos (`is_active=False`), enumeración y salteo de `UserAttributeSimilarityValidator` en `accept_invitation` / `InvitationAcceptView`
- **Gravedad:** alta
- **Dónde:** `backend/apps/accounts/invitations.py:100-124` y `backend/apps/api/v1/auth.py:129-145`
- **Qué pasa:**
  1. **Ausencia de chequeo de `user.is_active` y de `django-axes` al aceptar invitación de un usuario existente:** Cuando `User.objects.filter(email=invitation.email).first()` encuentra un usuario (`invitations.py:115`), `accept_invitation` ejecuta `elif not user.check_password(password): raise ValidationError(INVALID_INVITATION)` sin pasar por `authenticate(request, ...)` ni por `django-axes`, y si falla hace rollback dejando `invitation.used_at = None`. Luego `InvitationAcceptView` (`auth.py:143`) llama a `login(request, user, backend='django.contrib.auth.backends.ModelBackend')` sin comprobar `user.is_active`. Así:
     - Un usuario con `is_active=False` puede aceptar una invitación, asociarse a la organización o persona y obtener una sesión autenticada (`200 OK`).
     - Quien tenga un token de invitación para el email de un usuario existente (por ejemplo, un empleado malicioso en otra organización que invita ese email) puede probar contraseñas contra `user.check_password(password)` sin que `django-axes` registre ni bloquee ningún intento.
  2. **Enumeración de cuentas y oráculo de validez de token:**
     - Con un token válido, si el email **no** tiene `User`, cualquier contraseña fuerte crea el usuario y devuelve `200 OK`; si el email **ya** tiene `User` (por ejemplo, un residente o empleado en otra administradora), enviar una contraseña nueva devuelve `400` con `'El link no es válido o venció'`. Esto revela si ese email ya tiene usuario en el sistema y además impide que un usuario real invitado a una segunda organización complete el flujo si ingresa una contraseña nueva.
     - Enviar una contraseña débil (`'short'`) permite distinguir sin consumir el token si el token es válido (`400` con el mensaje de `MinimumLengthValidator`) o inválido/vencido (`400` con `'El link no es válido o venció'`), porque `validate_password` corre después de validar el token (`líneas 106-113`). Además, un token inválido retorna en ~1 ms sin ejecutar Argon2, mientras que un token válido ejecuta Argon2 (`create_user` o `check_password`).
  3. **Omisión de `UserAttributeSimilarityValidator`:** En `invitations.py:112`, `validate_password(password)` se llama sin pasar `user` (a diferencia de `confirm_password_reset` en `línea 170`), por lo que Django desactiva `UserAttributeSimilarityValidator` y permite elegir el propio email como contraseña (`'similar-user@example.com'`).
  - **Prueba ejecutada (`test_3_invitation_accept_bypasses_axes_allows_inactive_user_and_skips_similarity_validator` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    inactive_user = User.objects.create_user('inactive@example.com', PASSWORD, is_active=False)
    _, token_existing = invite_employee(
        org, admin, email=inactive_user.email, first_name='In', last_name='Activo'
    )

    client = _csrf_client()
    for i in range(8):
        res = client.post(
            '/api/v1/invitations/accept',
            {'token': token_existing, 'password': f'WrongPassword-{i}-12345'},
            format='json', REMOTE_ADDR='10.99.0.1', HTTP_X_FORWARDED_FOR=f'203.0.113.{i}',
        )
        assert res.status_code == 400

    ok_res = client.post(
        '/api/v1/invitations/accept', {'token': token_existing, 'password': PASSWORD},
        format='json', REMOTE_ADDR='10.99.0.1', HTTP_X_FORWARDED_FOR='203.0.113.99',
    )
    assert ok_res.status_code == 200
    assert OrgMembership.objects.filter(user=inactive_user, organization=org).exists()

    _, token_new = invite_employee(
        org, admin, email='similar-user@example.com', first_name='Similar', last_name='User'
    )
    accepted_new = accept_invitation(token_new, 'similar-user@example.com')
    assert accepted_new.check_password('similar-user@example.com')
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_3
    .                                                                        [100%]
    1 passed in 2.68s
    ```
- **Sugerencia:**
  1. En `accept_invitation`, rechazar usuarios con `not user.is_active` (`raise ValidationError(INVALID_INVITATION)`), y al verificar la contraseña de un usuario existente usar `authenticate(request, email=user.email, password=password)` (o registrar/verificar bloqueo en `axes`).
  2. Construir la instancia candidata `candidate = user or User(email=invitation.email, first_name=first_name or invitation.first_name, last_name=last_name or invitation.last_name)` y llamar siempre a `validate_password(password, candidate)`.

---

#### 4. Incumplimiento de la regla del ex inquilino (N17) en `MeView` (`/api/v1/auth/me`) y en `resident_buildings`
- **Gravedad:** alta
- **Dónde:** `backend/apps/api/v1/auth.py:72-82` y `backend/apps/api/scoping.py:52-55`
- **Qué pasa:**
  1. **`MeView` expone ocupaciones cerradas con saldo 0 (y futuras):** La regla N17 (`docs/modelo-datos.md` §1) exige que el ex inquilino *"Conserva el acceso al portal hasta saldar su deuda: ve solo su ocupación cerrada (saldo, movimientos, comprobantes) y puede subir comprobantes. Con saldo 0 deja de ver esa unidad"*. Mientras que `/api/v1/portal/occupancies` usa `resident_occupancies(user)` y devuelve `403` al ex inquilino con saldo 0, `MeView` (`auth.py:72-82`) serializa `person.occupancies.all()` sin filtrar por `resident_occupancies(user)`, exponiendo en `/api/v1/auth/me` todas las ocupaciones cerradas y saldadas (`id`, `unit_number`, `building_name`, `role`, `start_date`, `end_date`).
  2. **`resident_buildings(user)` incluye edificios de ocupaciones ya cerradas con deuda:** En `scoping.py:52-55`, `resident_buildings` filtra `Building.objects.filter(units__occupancies__in=resident_occupancies(user, on_date))`. Como `resident_occupancies` incluye ocupaciones cerradas (`end_date < on_date`) cuando `balance > 0`, `resident_buildings` devuelve el edificio de una ocupación ya finalizada, pese a que N17 indica que el ex inquilino moroso *"ve solo su ocupación cerrada (saldo, movimientos, comprobantes) ... No ve avisos ni reclamos del edificio posteriores a su salida"*.
  - **Prueba ejecutada (`test_4_me_view_and_resident_buildings_violate_ex_tenant_rule_n17` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    client = api_client_for(settled_user)
    assert client.get('/api/v1/portal/occupancies').status_code == 403
    assert list(resident_occupancies(settled_user)) == []

    me_res = client.get('/api/v1/auth/me')
    assert me_res.status_code == 200
    assert len(me_res.json()['persons'][0]['occupancies']) == 1
    assert me_res.json()['persons'][0]['occupancies'][0]['id'] == str(settled_occ.pk)

    assert list(resident_buildings(debtor_user)) == [building]
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_4
    .                                                                        [100%]
    1 passed in 2.31s
    ```
- **Sugerencia:**
  1. En `MeView.get` (`auth.py:72-82`), filtrar las ocupaciones devueltas usando `resident_occupancies(user)` (por ejemplo, agrupando por `person` solo las ocupaciones presentes en `resident_occupancies(user)`).
  2. En `resident_buildings(user, on_date=None)`, precisar si debe restringirse a ocupaciones vigentes (`end_date__isnull=True | end_date__gte=on_date`) o si las vistas de avisos/reclamos filtrarán por `created_at <= occupancy.end_date`, para que ningún endpoint de edificio exponga avisos o reclamos posteriores a la salida del ex inquilino moroso.

---

#### 5. No rotación de `sessionid` al autenticar sobre una sesión ya iniciada del mismo usuario y contaminación/omisión de `actor` en `audit_rowchange` (`login`, `accept_invitation`, `confirm_password_reset`)
- **Gravedad:** media
- **Dónde:** `backend/apps/api/v1/auth.py:54, 143`, `backend/apps/accounts/invitations.py:117-124, 171-172` y `backend/apps/audit/context.py:62-69`
- **Qué pasa:**
  1. **El `sessionid` no rota en `LoginView` ni en `InvitationAcceptView` si la sesión previa ya estaba autenticada con ese mismo `User`:** En Django, `login(request, user)` solo ejecuta `request.session.cycle_key()` cuando `SESSION_KEY not in request.session`, y solo ejecuta `request.session.flush()` si cambia el usuario o el hash de contraseña. Si un usuario con sesión abierta vuelve a autenticarse en `/api/v1/auth/login` o acepta una invitación para su usuario existente en `/api/v1/invitations/accept` (donde el hash de contraseña no cambia), `sessionid` queda **idéntico**.
  2. **Escrituras en `accounts_user` fuera de `audit_context(user)` (actor nulo o contaminado por sesión previa):**
     - En `accept_invitation` (`invitations.py:117-121`), `User.objects.create_user(...)` se ejecuta **antes** de `with audit_context(user, organization=invitation.organization):` (`línea 124`). Si no había sesión previa, el `INSERT` en `accounts_user` queda en `audit_rowchange` con `actor = None` y `organization_id = None`; y si en ese navegador había una sesión previa de `user_a`, `AuditContextMiddleware` dejó `app.actor_id = user_a.pk`, registrando en `audit_rowchange` que `user_a` creó a `user_b`.
     - En `LoginView` (`auth.py:54`) e `InvitationAcceptView` (`auth.py:143`), `login(request, user)` actualiza `user.last_login` fuera del `audit_context` del usuario entrante, dejando `actor = None` (o el `actor` de la sesión anterior) en `audit_rowchange`.
     - En `confirm_password_reset` (`invitations.py:171-172`), `user.save(update_fields=['password'])` corre fuera de `audit_context(user)` y sin `record_event`, dejando el cambio de contraseña en `audit_rowchange` con `actor = None`.
  - **Prueba ejecutada (`test_5_session_key_not_rotated_for_logged_in_user_and_audit_actor_contaminated_or_null` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    res1 = client.post('/api/v1/auth/login', {'email': user_a.email, 'password': PASSWORD}, format='json')
    session_before = client.cookies['sessionid'].value

    login_change = RowChange.objects.filter(
        table_name='accounts_user', row_id=user_a.pk, operation=RowChange.Operation.UPDATE,
    ).latest('created_at')
    assert login_change.actor is None

    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    res2 = client.post('/api/v1/auth/login', {'email': user_a.email, 'password': PASSWORD}, format='json')
    assert client.cookies['sessionid'].value == session_before

    _, token_b = invite_employee(org, user_a, email='user_b@example.com', first_name='User', last_name='B')
    client.get('/api/v1/auth/csrf')
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    client.post('/api/v1/invitations/accept', {'token': token_b, 'password': PASSWORD}, format='json')
    user_b = User.objects.get(email='user_b@example.com')
    insert_b = RowChange.objects.get(
        table_name='accounts_user', row_id=user_b.pk, operation=RowChange.Operation.INSERT,
    )
    assert insert_b.actor == user_a
    assert insert_b.organization_id is None
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_5
    .                                                                        [100%]
    1 passed in 2.61s
    ```
- **Sugerencia:**
  1. En `LoginView` e `InvitationAcceptView`, forzar siempre `request.session.cycle_key()` tras `login(request, user)` (o `logout(request)` antes de `login(request, user)` si ya había sesión activa) y envolver `login(request, user)` en `with audit_context(user):`.
  2. En `accept_invitation`, limpiar `actor` al crear un usuario nuevo o abrir `audit_context` antes del `create_user`, y en `confirm_password_reset` envolver `user.save(update_fields=['password'])` en `with audit_context(user):`.

---

#### 6. Recuperación de contraseña (`request_password_reset` / `confirm_password_reset`): envío sincrónico de email en `on_commit` (timing), cambio de contraseña en usuarios inactivos (`is_active=False`), falta de lock transaccional y filtración de error de UUID
- **Gravedad:** media
- **Dónde:** `backend/apps/accounts/invitations.py:146-173` y `backend/apps/api/v1/auth.py:147-170`
- **Qué pasa:**
  1. **Diferencia de tiempo de respuesta en `POST /api/v1/auth/password-reset`:** `request_password_reset` (`invitations.py:148-158`) solo genera el token y registra `transaction.on_commit(lambda: send_mail(...))` cuando `user` existe. Como `AuditContextMiddleware` envuelve todo `POST` en `with audit_context(...):` (que abre `with transaction.atomic():`), el callback `on_commit` se ejecuta sincrónicamente al cerrar el middleware **antes** de devolver la respuesta HTTP 204 al cliente, sumando la latencia de `send_mail` únicamente cuando el email existe.
  2. **`confirm_password_reset` permite cambiar la contraseña a usuarios con `is_active=False` y no bloquea la fila:** A diferencia de `request_password_reset` (que filtra `is_active=True`), `confirm_password_reset` (`invitations.py:164`) hace `User.objects.get(pk=user_id)` sin exigir `is_active=True` y sin `transaction.atomic()` + `select_for_update()`.
  3. **Filtración de error interno cuando `uid` decodifica a un string que no es UUID:** Si `uid` es base64 válido de un texto no UUID (por ejemplo, `urlsafe_base64_encode(b'123')` = `'MTIz'`), `User.objects.get(pk='123')` lanza `django.core.exceptions.ValidationError("['“123” no es un UUID válido.']")`. Esa excepción no entra en `except (ValueError, TypeError, OverflowError, User.DoesNotExist):` de `confirm_password_reset` (`invitations.py:165`), sino que llega a `PasswordResetConfirmView` (`auth.py:167`) y devuelve `400 {"detail": "['“123” no es un UUID válido.']"}` en vez de `'El link no es válido o venció'`.
  - **Prueba ejecutada (`test_6_password_reset_sync_email_timing_inactive_user_and_uuid_error_leak` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    token = PasswordResetTokenGenerator().make_token(inactive_user)
    uid = urlsafe_base64_encode(force_bytes(inactive_user.pk))
    confirm_password_reset(uid, token, 'NewValidPassword123!')
    inactive_user.refresh_from_db()
    assert inactive_user.check_password('NewValidPassword123!')

    bad_uid = urlsafe_base64_encode(b'123')
    res_bad_uid = client.post(
        '/api/v1/auth/password-reset/confirm',
        {'uid': bad_uid, 'token': 'any-token', 'password': 'NewValidPassword123!'},
        format='json',
    )
    assert res_bad_uid.status_code == 400
    assert 'UUID' in res_bad_uid.json()['detail']
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_6
    .                                                                        [100%]
    1 passed in 2.38s
    ```
- **Sugerencia:**
  1. En `confirm_password_reset`, envolver en `transaction.atomic()`, buscar `User.objects.select_for_update().get(pk=user_id, is_active=True)` y agregar `ValidationError` y `UnicodeDecodeError` a la tupla del `except` de `línea 165` para devolver siempre `'El link no es válido o venció'`.
  2. Despachar el envío de email de recuperación (e invitación) mediante tarea de Celery en `on_commit`, evitando bloquear el request HTTP con SMTP sincrónico solo cuando el email existe.

---

#### 7. Excepciones no controladas (`500 Internal Server Error`) ante entradas mal formadas, discrepancias de códigos HTTP (`400`/`404` vs `403`/`404`) y falso positivo en `assert_cross_org_404`
- **Gravedad:** media / baja
- **Dónde:** `backend/apps/api/v1/auth.py:45-55, 90-170`, `backend/apps/accounts/invitations.py:25-26, 80-86, 100-173` y `backend/apps/api/testing.py:13-18`
- **Qué pasa:**
  1. **Errores 500 por falta de validación de tipos y de UUIDs en `auth.py`:**
     - En `EmployeeInviteView` (`auth.py:95`) y `ResidentInviteView` (`auth.py:114-117`), `memberships.filter(organization_id=...)` y `Person.objects.filter(pk=...)` se ejecutan **fuera** del bloque `try ... except ValidationError`. Si `organization_id` o `person_id` no es un UUID válido (`"not-a-uuid"`), Django lanza `django.core.exceptions.ValidationError` no capturado por DRF (`500 Internal Server Error`).
     - Enviar `null`, enteros o listas en campos JSON (`{"email": "...", "password": 123}` en `auth/login`; `{"token": null, "password": "..."}` en `invitations/accept`; `{"uid": 123, ...}` en `auth/password-reset/confirm`; `{"email": 123}` en `auth/password-reset`; `{"email": null, ...}` o `{"first_name": null, ...}` en `invitations/employees`; o un JSON `[]` como raíz del body) lanza `AttributeError`, `TypeError` o `IntegrityError` no capturados (`500`).
     - Además, ante `KeyError` se responde `error(str(exc))` exponiendo el nombre de la clave (`{"detail": "'password'"}`), y ante `ValidationError` se serializa la representación cruda de lista (`"['...']"`).
  2. **Códigos HTTP e `if organization_id:` en `EmployeeInviteView` y `ResidentInviteView`:**
     - Ni `EmployeeInviteView` ni `ResidentInviteView` declaran `permission_classes = [IsEmployee]`. Un residente sin membresías recibe `400` en `/api/v1/invitations/employees` y `404` en `/api/v1/invitations/residents` en lugar de `403`.
     - Cuando un empleado de la Organización A envía `organization_id` de la Organización B a `POST /api/v1/invitations/employees`, la vista devuelve `400 {"detail": "Organización inválida"}` en vez de `404` (regla multi-tenant de `.github/copilot-instructions.md`).
     - Por evaluar `if organization_id:` por truthiness (`auth.py:94`) en vez de `if organization_id is not None:`, enviar `"organization_id": ""` cuando el empleado pertenece a una única organización ignora el parámetro inválido y crea la invitación en su organización (`201`).
  3. **`assert_cross_org_404` (`backend/apps/api/testing.py:17`) no comprueba la ausencia del UUID ajeno en rutas anidadas:**
     - `assert url.rstrip('/').rsplit('/', 1)[-1].lower() not in body` verifica únicamente el último segmento del path. En rutas como `/api/v1/organizations/{org_b.pk}/buildings` (`test_scoping.py:41`), ese segmento es `'buildings'` y no `str(org_b.pk)`.
  - **Prueba ejecutada (`test_7_unhandled_500_on_malformed_inputs_and_status_code_mismatches` en `/tmp/agy-review3/test_audit_c1_c2.py`):**
    ```python
    with pytest.raises(ValidationError):
        client_emp.post(
            '/api/v1/invitations/employees',
            {'organization_id': 'not-a-uuid', 'email': 'x@example.com', 'first_name': 'A', 'last_name': 'B'},
            format='json',
        )
    with pytest.raises(ValidationError):
        client_emp.post('/api/v1/invitations/residents', {'person_id': 'not-a-uuid'}, format='json')

    with pytest.raises(AttributeError):
        anon.post('/api/v1/auth/login', {'email': emp_a.email, 'password': 123}, format='json')
    with pytest.raises(AttributeError):
        anon.post('/api/v1/invitations/accept', {'token': None, 'password': PASSWORD}, format='json')
    with pytest.raises(AttributeError):
        anon.post('/api/v1/auth/password-reset/confirm', {'uid': 123, 'token': 'x', 'password': PASSWORD}, format='json')

    cross_res = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': str(org_b.pk), 'email': 'cross@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert cross_res.status_code == 400

    empty_org_res = client_emp.post(
        '/api/v1/invitations/employees',
        {'organization_id': '', 'email': 'empty-org@example.com', 'first_name': 'A', 'last_name': 'B'},
        format='json',
    )
    assert empty_org_res.status_code == 201
    ```
    Comando y salida:
    ```text
    $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review -k test_7
    .                                                                        [100%]
    1 passed in 2.30s
    ```
- **Sugerencia:**
  1. Validar los payloads de `auth.py` con serializers de DRF (o verificar `isinstance(request.data, Mapping)` y que cada campo sea `str` / `UUID` válido antes de consultar el ORM o hashear), devolviendo `exc.messages[0]` en `ValidationError`.
  2. Agregar `permission_classes = [IsEmployee]` en `EmployeeInviteView` y `ResidentInviteView`, verificar `if organization_id is not None:` y resolver la organización con `get_in_scope_or_404(employee_organizations(request.user), organization_id)` para devolver `404` ante una organización ajena.
  3. En `assert_cross_org_404` (`testing.py:17`), extraer todos los segmentos con formato UUID de la URL (con `re.findall`) y verificar que ninguno aparezca en `body`.

---

#### Sin confirmar
- **Carrera al aceptar simultáneamente dos invitaciones distintas para el mismo email aún sin `User`:** En `accept_invitation` (`invitations.py:103-121`), `select_for_update()` bloquea la fila de `Invitation`, pero si existen dos invitaciones vigentes en organizaciones distintas para el mismo email nuevo y se aceptan en paralelo, ambas ven `User.objects.filter(email=invitation.email).first() is None` y la segunda puede fallar con `IntegrityError` sobre `accounts_user_email_lower_unique`. No se reprodujo con hilos en la suite para no alterar conexiones del runner, pero se previene capturando `IntegrityError` o bloqueando de forma determinística.

## Cómo lo verifiqué
- Verifiqué en los repositorios oficiales `actions/checkout` y `actions/setup-python` los tags mayores vigentes (`v7`) y sus `action.yml` (`runs.using: node24`), actualicé `.github/workflows/ci.yml` y validé la sintaxis YAML con `YAML.safe_load`.
- Extraje el commit `540a194` en `/tmp/agy-src3` y ejecuté la suite de reproducciones en `/tmp/agy-review3/test_audit_c1_c2.py`:
  ```text
  $ docker compose run --rm -e DB_NAME=agy_review3 -v /tmp/agy-src3/backend:/app -v /tmp/agy-review3:/review web pytest -q -p no:cacheprovider /review
  .......                                                                  [100%]
  7 passed in 4.32s
  ```
- Verifiqué también que la suite existente de `api` y `accounts` en `/tmp/agy-src3` pasa íntegra (`31 passed`).

## Preguntas / pedidos al orquestador
- En `.github/workflows/ci.yml` subí `actions/checkout` y `actions/setup-python` a `@v7` (la versión mayor vigente en ambos repositorios oficiales de GitHub Actions, cuyos `action.yml` usan `node24`; `@v6` también usa `node24` en ambos). Confirmar si se prefiere mantener `@v7` o fijar `@v6`.

ESTADO: listo
