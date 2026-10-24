from datetime import date, timedelta

import pytest
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import DatabaseError, connection, transaction
from django.utils import timezone

from apps.communications.models import Claim, ClaimMessage
from apps.communications.services import (
    create_task,
    open_claim,
    publish_notice,
    reply_as_admin,
    reply_as_resident,
    set_claim_status,
    toggle_task,
)
from apps.people.models import Occupancy
from tests.factories import (
    BuildingFactory,
    ClaimFactory,
    OrgMembershipFactory,
    PersonFactory,
    TaskFactory,
    UnitFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


def employee_for(building):
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=building.organization)
    return user


def resident_for(unit, *, end_date=None):
    user = UserFactory()
    person = PersonFactory(organization=unit.building.organization, user=user)
    occupancy = Occupancy.objects.create(
        unit=unit,
        person=person,
        role=Occupancy.Role.TENANT,
        start_date=timezone.localdate() - timedelta(days=1),
        end_date=end_date,
    )
    return user, person, occupancy


def test_publish_notice_validates_content_and_employee_tenant():
    building = BuildingFactory()
    user = employee_for(building)
    notice = publish_notice(building, user, 'Corte de agua', 'El servicio se interrumpirá mañana.')
    assert notice.published_by == user

    with pytest.raises(ValidationError):
        publish_notice(building, user, 'No', 'El cuerpo es suficientemente largo.')
    with pytest.raises(ValidationError):
        publish_notice(building, user, 'Aviso', 'Corto')

    foreign_building = BuildingFactory()
    with pytest.raises(PermissionDenied):
        publish_notice(foreign_building, user, 'Aviso válido', 'Un cuerpo suficientemente largo.')


def test_open_claim_requires_current_occupancy_and_own_user():
    unit = UnitFactory()
    user, person, _ = resident_for(unit)
    claim = open_claim(
        person, unit, Claim.Kind.REPORT, 'Fuga de agua', '', user
    )
    assert claim.status == Claim.Status.PENDING
    assert claim.messages.get().text == claim.title
    assert claim.messages.get().from_admin is False

    other_unit = UnitFactory(building=unit.building)
    with pytest.raises(PermissionDenied):
        open_claim(person, other_unit, Claim.Kind.REPORT, 'Otro problema', 'Detalle', user)

    closed_unit = UnitFactory(building=unit.building)
    closed_user, closed_person, _ = resident_for(
        closed_unit, end_date=timezone.localdate() - timedelta(days=1)
    )
    with pytest.raises(PermissionDenied):
        open_claim(
            closed_person, closed_unit, Claim.Kind.REPORT, 'Cerrado', 'Detalle', closed_user
        )

    other_user = UserFactory()
    with pytest.raises(PermissionDenied):
        open_claim(person, unit, Claim.Kind.REPORT, 'No autorizado', 'Detalle', other_user)


def test_reply_as_admin_marks_pending_claim_in_progress():
    claim = ClaimFactory()
    user = employee_for(claim.building)
    message = reply_as_admin(claim, user, 'Lo revisamos.')
    claim.refresh_from_db()
    assert message.from_admin is True
    assert claim.status == Claim.Status.IN_PROGRESS


def test_reply_as_resident_rejects_resolved_and_foreign_claim():
    unit = UnitFactory()
    user, person, _ = resident_for(unit)
    claim = open_claim(person, unit, Claim.Kind.COMPLAINT, 'Ruido', 'Detalle', user)
    claim.status = Claim.Status.RESOLVED
    claim.save(update_fields=['status', 'updated_at'])
    with pytest.raises(ValidationError, match='está resuelto'):
        reply_as_resident(claim, person, user, 'Sigue igual.')

    other_unit = UnitFactory(building=unit.building)
    other_user, other_person, _ = resident_for(other_unit)
    other_claim = open_claim(
        other_person, other_unit, Claim.Kind.REPORT, 'Otro', 'Detalle', other_user
    )
    with pytest.raises(PermissionDenied):
        reply_as_resident(other_claim, person, user, 'No corresponde.')


def test_claim_status_allows_only_diagram_transitions():
    building = BuildingFactory()
    user = employee_for(building)
    claim = ClaimFactory(building=building)
    set_claim_status(claim, user, Claim.Status.IN_PROGRESS)
    set_claim_status(claim, user, Claim.Status.RESOLVED)
    set_claim_status(claim, user, Claim.Status.IN_PROGRESS)

    with pytest.raises(ValidationError):
        set_claim_status(claim, user, 'unknown')
    with pytest.raises(ValidationError):
        set_claim_status(claim, user, Claim.Status.PENDING)


def test_claim_message_is_append_only_including_truncate():
    claim = ClaimFactory()
    message = ClaimMessage.objects.create(
        claim=claim,
        author=UserFactory(),
        text='Original',
    )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    'UPDATE communications_claimmessage SET text = %s WHERE id = %s',
                    ['Alterado', str(message.id)],
                )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    'DELETE FROM communications_claimmessage WHERE id = %s',
                    [str(message.id)],
                )
    with pytest.raises(DatabaseError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('TRUNCATE communications_claimmessage')


def test_tasks_can_toggle_and_reject_foreign_building():
    building = BuildingFactory()
    user = employee_for(building)
    task = create_task(building.organization, building, user, 'Llamar al proveedor')
    assert task.done is False
    assert toggle_task(task, user).done is True
    assert toggle_task(task, user).done is False

    foreign_building = BuildingFactory()
    with pytest.raises(ValidationError):
        create_task(building.organization, foreign_building, user, 'Tarea cruzada')


def test_communications_tables_have_audit_triggers():
    building = BuildingFactory()
    claim = ClaimFactory(building=building)
    task = TaskFactory(building=building, organization=building.organization)
    expected = {
        'communications_notice',
        'communications_claim',
        'communications_claimmessage',
        'communications_task',
    }
    with connection.cursor() as cursor:
        for table in expected:
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
                [table, '%audit_row_change%'],
            )
            assert cursor.fetchone()[0], table
