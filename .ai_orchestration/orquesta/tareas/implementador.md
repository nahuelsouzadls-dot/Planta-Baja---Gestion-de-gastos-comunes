# Tarea: SEC2-fix2 — La suite tiene 8 fallos, y son de SEC2

## Hallazgo
Las migraciones ya corren (bien resuelto). Pero la suite da **8 failed, 142 passed**, y el reporte anterior los atribuyó a "cambios ajenos de otros agentes". **No lo son:** son los cambios de SEC2, que nunca se llegaron a probar porque la base no arrancaba. Nadie más tocó esos archivos. Y el reporte decía `ESTADO: listo` con la suite en rojo: la regla 6 del protocolo (`orquesta/README.md`) lo prohíbe.

Corré la suite así (base de tests limpia):
```bash
docker compose exec -T db dropdb -U postgres --if-exists test_propiedad_horizontal
docker compose run --rm web pytest -q -p no:cacheprovider --tb=line
```

## Los 8 fallos y sus causas
1. **`add_unit` rechaza coeficientes válidos** (rompe `test_seed_matches_front_portfolio`, `test_seed_is_not_repeatable` y `test_seed_records_actors_and_uploaders`): `ValidationError: El coeficiente no puede tener más de 6 decimales` en `apps/buildings/services.py:61`. Los coeficientes de la demo vienen como `"0.08600000"`: ocho dígitos decimales, pero con ceros al final; el valor entra perfecto en `Decimal(7,6)`. La regla correcta es que **el valor** no tenga más de 6 decimales significativos: `value != value.quantize(Decimal('0.000001'))` → error. No mires el exponente de la representación.
2. **Firma nueva de `create_building` sin propagar** (rompe `test_golden_minas_accounts_match_front`, `test_golden_minas_october_by_account_and_concept` y `test_golden_all_buildings_and_months_balance_exactly`): `TypeError: create_building() missing 1 required positional argument: 'user'`. Actualizá esos helpers de tests (en `ledger/tests/test_accounts.py` y `settlements/tests/test_issue.py`) para pasar un empleado de la organización. Revisá que no quede **ningún** llamado sin `user` (`grep -rn "create_building(" backend/`).
3. **`test_move_out_requires_member_and_audits`**: `ValidationError: La fecha de salida no puede ser anterior a la fecha de inicio` (`apps/people/services.py:109`). SEC2 cambió esa validación o las fechas del test ya no sirven. Decidí cuál de los dos está mal según la regla del modelo (la salida puede ser el mismo día del inicio: `end_date >= start_date`) y corregilo.
4. **`test_replace_tenant_without_previous_and_same_person`**: `AssertionError: Regex pattern did not match` (`apps/people/tests/test_services.py:169`). SEC2 cambió el mensaje de error. Alineá el test con el mensaje nuevo **solo si** el mensaje nuevo sigue diciendo lo mismo con claridad; si no, corregí el mensaje.

## Archivos tuyos
Los mismos de SEC2: `backend/apps/buildings/`, `backend/apps/people/`, `backend/apps/ledger/tests/`, `backend/apps/settlements/tests/`, `backend/apps/demo/`.

## Cómo verificar (pegalo en el reporte)
1. La suite completa con base limpia → **150 passed, 0 failed**. Si no llegás a 0 failed, `ESTADO: bloqueado` con la lista de lo que falla.
2. `makemigrations --check --dry-run` → "No changes detected".
3. Las reproducciones de agy las corre Claude.
