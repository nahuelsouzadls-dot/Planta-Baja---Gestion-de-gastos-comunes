import pytest
from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import connection, DatabaseError, transaction
from django.urls import reverse

from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.audit.models import AuditLog, RowChange
from apps.buildings.models import Building
from apps.core.money import format_money
from apps.ledger.services import record_opening
from apps.people.models import Person
from apps.settlements.services import delete_draft
from tests.factories import (
    BuildingFactory,
    ExpenseConceptFactory,
    OccupancyFactory,
    SettlementFactory,
    SettlementItemFactory,
    UserFactory,
)


pytestmark = pytest.mark.django_db


def test_update_records_diff_and_actor():
    user = UserFactory()
    building = BuildingFactory(name='viejo')

    with audit_context(user, building.organization):
        building.name = 'nuevo'
        building.save()

    change = RowChange.objects.get(
        table_name='buildings_building',
        row_id=building.id,
        operation=RowChange.Operation.UPDATE,
    )
    assert change.old_values == {'name': 'viejo'}
    assert change.new_values == {'name': 'nuevo'}
    assert change.actor == user


def test_update_without_context_has_no_actor_and_has_database_user():
    building = BuildingFactory(name='viejo')
    Building.objects.filter(pk=building.pk).update(name='nuevo')

    change = RowChange.objects.get(
        table_name='buildings_building',
        row_id=building.id,
        operation=RowChange.Operation.UPDATE,
    )
    assert change.actor is None
    assert change.db_user


def test_raw_update_is_recorded():
    building = BuildingFactory()
    with connection.cursor() as cursor:
        cursor.execute(
            'UPDATE buildings_building SET name = %s WHERE id = %s',
            ['por SQL', str(building.id)],
        )

    change = RowChange.objects.get(
        table_name='buildings_building',
        row_id=building.id,
        operation=RowChange.Operation.UPDATE,
    )
    assert change.old_values == {'name': building.name}
    assert change.new_values == {'name': 'por SQL'}


def test_password_is_masked():
    user = UserFactory()
    user.set_password('new-password-123')
    user.save()

    change = RowChange.objects.get(
        table_name='accounts_user',
        row_id=user.id,
        operation=RowChange.Operation.UPDATE,
    )
    assert change.new_values == {'password': '[cambiado]'}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT count(*) FROM audit_rowchange
            WHERE old_values::text LIKE %s OR new_values::text LIKE %s
            """,
            ['%argon2%', '%argon2%'],
        )
        assert cursor.fetchone()[0] == 0


def test_admin_update_records_diff_actor_and_request_path(client):
    admin_user = UserFactory(is_staff=True, is_superuser=True)
    building = BuildingFactory(name='viejo')
    client.force_login(admin_user)
    path = reverse('admin:buildings_building_change', args=[building.pk])

    response = client.post(
        path,
        {
            'organization': str(building.organization_id),
            'name': 'nuevo',
            'address': building.address,
            'neighborhood': building.neighborhood,
            'city': building.city,
            'bank_name': building.bank_name,
            'bank_account': building.bank_account,
            'bank_holder': building.bank_holder,
            'due_day': str(building.due_day),
            'reserve_opening': str(building.reserve_opening),
            'opening_date': '',
            'is_active': 'on',
            'units-TOTAL_FORMS': '0',
            'units-INITIAL_FORMS': '0',
            'units-MIN_NUM_FORMS': '0',
            'units-MAX_NUM_FORMS': '1000',
            'concepts-TOTAL_FORMS': '0',
            'concepts-INITIAL_FORMS': '0',
            'concepts-MIN_NUM_FORMS': '0',
            'concepts-MAX_NUM_FORMS': '1000',
            '_save': 'Guardar',
        },
    )

    assert response.status_code == 302
    change = RowChange.objects.get(
        table_name='buildings_building',
        row_id=building.id,
        operation=RowChange.Operation.UPDATE,
    )
    assert change.actor == admin_user
    assert change.request_path == path
    assert change.old_values == {'name': 'viejo'}
    assert change.new_values == {'name': 'nuevo'}


def test_person_insert_is_audited():
    user = UserFactory()
    building = BuildingFactory()
    with audit_context(user, building.organization):
        person = Person.objects.create(
            organization=building.organization,
            first_name='Ana',
            last_name='Pérez',
            email='ana@example.com',
        )

    change = RowChange.objects.get(
        table_name='people_person',
        row_id=person.id,
        operation=RowChange.Operation.INSERT,
    )
    assert change.actor == user
    assert change.new_values['first_name'] == 'Ana'
    assert change.new_values['last_name'] == 'Pérez'
    assert change.new_values['email'] == 'ana@example.com'


def test_delete_draft_audits_items_and_settlement():
    building = BuildingFactory()
    settlement = SettlementFactory(building=building)
    first_concept = ExpenseConceptFactory(building=building)
    second_concept = ExpenseConceptFactory(building=building)
    first_item = SettlementItemFactory(
        settlement=settlement,
        concept=first_concept,
        amount='100.00',
    )
    second_item = SettlementItemFactory(
        settlement=settlement,
        concept=second_concept,
        amount='200.00',
    )

    delete_draft(settlement)

    changes = RowChange.objects.filter(operation=RowChange.Operation.DELETE)
    assert changes.count() == 3
    deleted_rows = {(change.table_name, change.row_id): change for change in changes}
    assert deleted_rows[('settlements_settlementitem', first_item.id)].old_values['id'] == str(
        first_item.id
    )
    assert deleted_rows[('settlements_settlementitem', second_item.id)].old_values['id'] == str(
        second_item.id
    )
    assert deleted_rows[('settlements_settlement', settlement.id)].old_values['id'] == str(
        settlement.id
    )


def test_record_opening_is_audited_with_actor():
    user = UserFactory()
    occupancy = OccupancyFactory()

    with audit_context(user):
        entry = record_opening(
            occupancy=occupancy,
            amount='125.50',
            on_date='2026-10-01',
            user=user,
        )

    change = RowChange.objects.get(
        table_name='ledger_ledgerentry',
        row_id=entry.id,
        operation=RowChange.Operation.INSERT,
    )
    assert change.actor == user


def test_rowchange_is_append_only():
    building = BuildingFactory()
    change = RowChange.objects.get(
        table_name='buildings_building',
        row_id=building.id,
        operation=RowChange.Operation.INSERT,
    )
    change = RowChange.objects.first()
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE audit_rowchange SET db_user = %s WHERE id = %s',
                    ['tampered', str(change.id)],
                )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    'DELETE FROM audit_rowchange WHERE id = %s',
                    [str(change.id)],
                )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('TRUNCATE audit_rowchange')


def test_audit_log_is_append_only():
    user = UserFactory()
    building = BuildingFactory()
    event = AuditLog.objects.create(
        actor=user,
        organization=building.organization,
        action='test.event',
        target_type='buildings.building',
        target_id=building.id,
        summary='Evento de prueba',
        data={},
    )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE audit_auditlog SET summary = %s WHERE id = %s',
                    ['alterado', str(event.id)],
                )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    'DELETE FROM audit_auditlog WHERE id = %s',
                    [str(event.id)],
                )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('TRUNCATE audit_auditlog')


def test_record_event_rejects_sensitive_data():
    user = UserFactory()
    building = BuildingFactory()
    with pytest.raises(ValueError):
        record_event(
            user,
            building.organization,
            'test.event',
            building,
            'Evento inválido',
            data={'phone': '099123456'},
        )


def test_format_money_uses_uyuguayan_format():
    from decimal import Decimal

    assert format_money(Decimal('48300')) == '$ 48.300,00'
    assert format_money(Decimal('-61.2')) == '−$ 61,20'


def test_all_business_models_have_audit_trigger():
    expected_apps = (
        'accounts',
        'buildings',
        'people',
        'settlements',
        'ledger',
        'communications',
    )
    with connection.cursor() as cursor:
        for app_label in expected_apps:
            for model in apps.get_app_config(app_label).get_models():
                if model._meta.abstract:
                    continue
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_trigger
                        WHERE tgrelid = %s::regclass
                          AND NOT tgisinternal
                          AND pg_get_triggerdef(oid) LIKE %s
                    )
                    """,
                    [model._meta.db_table, '%audit_row_change%'],
                )
                assert cursor.fetchone()[0], model._meta.db_table
