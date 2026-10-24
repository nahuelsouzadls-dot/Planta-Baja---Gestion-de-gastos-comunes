from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import PermissionDenied, ValidationError

from apps.people.models import Occupancy
from apps.people.services import (
    UNSET,
    correct_occupancy,
    current_occupancy,
    days_in_month,
    move_in,
    move_out,
    occupancies_in_month,
    owner_gaps,
    replace_tenant,
    sell_unit,
    update_person,
)
from apps.ledger.models import LedgerEntry
from apps.ledger.services import record_opening
from apps.audit.models import RowChange
from tests.factories import (
    BuildingFactory, OccupancyFactory, OrgMembershipFactory, PersonFactory, UnitFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


def employee_for(organization):
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=organization)
    return user


@pytest.mark.django_db
def test_move_in_rejects_person_from_another_organization():
    unit = UnitFactory()
    person = PersonFactory()
    user = employee_for(unit.building.organization)
    with pytest.raises(ValidationError, match='misma organización'):
        move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1), user)


@pytest.mark.django_db
def test_move_in_translates_overlap_integrity_error():
    unit = UnitFactory()
    person = PersonFactory(organization=unit.building.organization)
    other = PersonFactory(organization=unit.building.organization)
    user = employee_for(unit.building.organization)
    move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1), user)
    with pytest.raises(ValidationError, match='unidad'):
        move_in(unit, other, Occupancy.Role.TENANT, date(2026, 3, 15), user)


def test_move_in_requires_member_and_audits():
    unit = UnitFactory()
    person = PersonFactory(organization=unit.building.organization)
    with pytest.raises(TypeError):
        move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1))

    foreign_user = employee_for(BuildingFactory().organization)
    with pytest.raises(PermissionDenied):
        move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1), foreign_user)

    user = employee_for(unit.building.organization)
    occupancy = move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1), user)
    assert RowChange.objects.filter(
        table_name='people_occupancy', row_id=occupancy.id, actor=user
    ).exists()


def test_move_in_rejects_second_owner():
    unit = UnitFactory()
    organization = unit.building.organization
    user = employee_for(organization)
    owner = PersonFactory(organization=organization)
    second_owner = PersonFactory(organization=organization)
    move_in(unit, owner, Occupancy.Role.OWNER, date(2026, 1, 1), user)
    with pytest.raises(ValidationError, match='venta'):
        move_in(unit, second_owner, Occupancy.Role.OWNER, date(2026, 3, 1), user)


@pytest.mark.django_db
def test_move_out_only_closes_current_tenant():
    owner = OccupancyFactory(role=Occupancy.Role.OWNER, end_date=None)
    user = employee_for(owner.unit.building.organization)
    with pytest.raises(ValidationError, match='propietario'):
        move_out(owner, date(2026, 3, 10), user)

    tenant = OccupancyFactory(
        unit=owner.unit,
        person=PersonFactory(organization=owner.unit.building.organization),
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 3, 1),
    )
    move_out(tenant, date(2026, 3, 14), user)
    with pytest.raises(ValidationError, match='cerrada'):
        move_out(tenant, date(2026, 3, 15), user)

    open_tenant = OccupancyFactory(
        unit=UnitFactory(building=owner.unit.building),
        person=PersonFactory(organization=owner.unit.building.organization),
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 3, 10),
    )
    with pytest.raises(ValidationError, match='anterior'):
        move_out(open_tenant, date(2026, 3, 9), user)


def test_move_out_requires_member_and_audits():
    occupancy = OccupancyFactory()
    with pytest.raises(TypeError):
        move_out(occupancy, date(2026, 3, 1))
    user = employee_for(occupancy.unit.building.organization)
    move_out(occupancy, date(2026, 3, 1), user)
    assert RowChange.objects.filter(
        table_name='people_occupancy', row_id=occupancy.id, actor=user,
        operation=RowChange.Operation.UPDATE,
    ).exists()


def test_replace_tenant_is_atomic():
    unit = UnitFactory()
    organization = unit.building.organization
    user = employee_for(organization)
    first = PersonFactory(organization=organization)
    second = PersonFactory(organization=organization)
    tenant = OccupancyFactory(
        unit=unit, person=first, role=Occupancy.Role.TENANT,
        start_date=date(2026, 1, 1),
    )
    replacement = replace_tenant(unit, second, date(2026, 3, 15), user)
    tenant.refresh_from_db()
    assert tenant.end_date == date(2026, 3, 14)
    assert replacement.start_date == date(2026, 3, 15)
    assert days_in_month(tenant, date(2026, 3, 1)) == 14
    assert days_in_month(replacement, date(2026, 3, 1)) == 17

    failure_unit = UnitFactory(building=unit.building)
    failure_first = PersonFactory(organization=organization)
    third = PersonFactory(organization=organization)
    failure_tenant = OccupancyFactory(
        unit=failure_unit, person=failure_first, role=Occupancy.Role.TENANT,
        start_date=date(2026, 1, 1), end_date=date(2026, 5, 31),
    )
    future = OccupancyFactory(
        unit=failure_unit, person=third, role=Occupancy.Role.TENANT,
        start_date=date(2026, 6, 1),
    )
    with pytest.raises(ValidationError):
        replace_tenant(failure_unit, third, date(2026, 5, 1), user)
    failure_tenant.refresh_from_db()
    assert failure_tenant.end_date == date(2026, 5, 31)
    future.refresh_from_db()


def test_replace_tenant_without_previous_and_same_person():
    unit = UnitFactory()
    organization = unit.building.organization
    user = employee_for(organization)
    person = PersonFactory(organization=organization)
    replacement = replace_tenant(unit, person, date(2026, 3, 15), user)
    assert replacement.person_id == person.id
    with pytest.raises(ValidationError, match='actual'):
        replace_tenant(unit, person, date(2026, 3, 15), user)


def test_correct_occupancy_updates_and_reopens():
    occupancy = OccupancyFactory(start_date=date(2026, 1, 1), end_date=date(2026, 1, 31))
    organization = occupancy.unit.building.organization
    user = employee_for(organization)
    person = PersonFactory(organization=organization)
    corrected = correct_occupancy(
        occupancy, user, person=person, start_date=date(2026, 1, 2), end_date=None
    )
    corrected.refresh_from_db()
    assert corrected.person_id == person.id
    assert corrected.start_date == date(2026, 1, 2)
    assert corrected.end_date is None
    assert UNSET is not None


def test_correct_occupancy_rejects_ledger_and_overlap():
    occupancy = OccupancyFactory()
    organization = occupancy.unit.building.organization
    user = employee_for(organization)
    LedgerEntry.objects.create(
        occupancy=occupancy, date=date(2026, 1, 1),
        kind=LedgerEntry.Kind.SURCHARGE, amount=Decimal('1.00'), created_by=user,
    )
    with pytest.raises(ValidationError, match='cargos o pagos'):
        correct_occupancy(occupancy, user, start_date=date(2026, 2, 1))

    clean = OccupancyFactory(
        unit=UnitFactory(building=occupancy.unit.building),
        start_date=date(2026, 1, 1), end_date=date(2026, 2, 28),
    )
    other = OccupancyFactory(
        unit=clean.unit, role=clean.role,
        start_date=date(2026, 3, 1), end_date=None,
    )
    with pytest.raises(ValidationError, match='superpone'):
        correct_occupancy(other, user, start_date=date(2026, 1, 15))


def test_update_person_validates_fields_and_audits():
    person = PersonFactory()
    user = employee_for(person.organization)
    updated = update_person(
        person, user, phone='099 123 456', document='12345678', email='  NEW@Example.COM '
    )
    assert updated.phone == '099 123 456'
    assert updated.document == '12345678'
    assert updated.email == 'new@example.com'
    assert RowChange.objects.filter(
        table_name='people_person', row_id=person.id, actor=user,
        operation=RowChange.Operation.UPDATE,
    ).exists()
    with pytest.raises(ValidationError):
        update_person(person, user, organization=BuildingFactory().organization)

    person.user = UserFactory()
    person.save(update_fields=['user', 'updated_at'])
    with pytest.raises(ValidationError, match='ya tiene cuenta'):
        update_person(person, user, email='other@example.com')


@pytest.mark.django_db
def test_current_occupancy_and_days_in_month_use_inclusive_dates():
    unit = UnitFactory()
    person = PersonFactory(organization=unit.building.organization)
    user = employee_for(unit.building.organization)
    occupancy = move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1), user)
    occupancy.end_date = date(2026, 3, 14)
    occupancy.save(update_fields=['end_date', 'updated_at'])
    assert current_occupancy(unit, Occupancy.Role.TENANT, date(2026, 3, 14)) == occupancy
    assert days_in_month(occupancy, date(2026, 3, 1)) == 14

    open_occupancy = OccupancyFactory(
        unit=UnitFactory(),
        start_date=date(2026, 3, 15),
        end_date=None,
    )
    assert days_in_month(open_occupancy, date(2026, 3, 1)) == 17


@pytest.mark.django_db
def test_days_in_month_handles_non_overlapping_february():
    february_occupancy = OccupancyFactory(start_date=date(2026, 1, 10), end_date=None)
    april_occupancy = OccupancyFactory(start_date=date(2026, 4, 1), end_date=None)
    assert days_in_month(february_occupancy, date(2026, 2, 1)) == 28
    assert days_in_month(april_occupancy, date(2026, 2, 1)) == 0


@pytest.mark.django_db
def test_occupancies_in_month_and_owner_gaps():
    unit = UnitFactory()
    owner = PersonFactory(organization=unit.building.organization)
    user = employee_for(unit.building.organization)
    occupancy = move_in(unit, owner, Occupancy.Role.OWNER, date(2026, 1, 1), user)
    assert occupancies_in_month(unit, date(2026, 3, 1)) == [(occupancy, 31)]
    assert owner_gaps(unit, date(2026, 3, 1)) == 0

    unit_without_owner = UnitFactory()
    assert owner_gaps(unit_without_owner, date(2026, 3, 1)) == 31


def test_sell_rejects_debtor_and_rolls_back():
    owner = OccupancyFactory(role=Occupancy.Role.OWNER)
    buyer = PersonFactory(organization=owner.unit.building.organization)
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=owner.unit.building.organization)
    LedgerEntry.objects.create(
        occupancy=owner, date=date(2026, 1, 1), kind=LedgerEntry.Kind.SURCHARGE,
        amount=500, created_by=user,
    )
    with pytest.raises(ValidationError, match='500.00'):
        sell_unit(owner.unit, buyer, date(2026, 3, 1), user)
    owner.refresh_from_db()
    assert owner.end_date is None
    assert not owner.unit.occupancies.filter(person=buyer).exists()


def test_sell_closes_owner_and_creates_buyer():
    owner = OccupancyFactory(role=Occupancy.Role.OWNER)
    buyer = PersonFactory(organization=owner.unit.building.organization)
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=owner.unit.building.organization)
    new_owner = sell_unit(owner.unit, buyer, date(2026, 3, 1), user)
    owner.refresh_from_db()
    assert owner.end_date == date(2026, 2, 28)
    assert new_owner.person_id == buyer.id
    assert new_owner.start_date == date(2026, 3, 1)


def test_sell_allows_credit_and_rejects_foreign_employee():
    owner = OccupancyFactory(role=Occupancy.Role.OWNER)
    buyer = PersonFactory(organization=owner.unit.building.organization)
    user = UserFactory()
    OrgMembershipFactory(user=user, organization=owner.unit.building.organization)
    record_opening(owner, Decimal('-10.00'), date(2026, 1, 1), user)
    sell_unit(owner.unit, buyer, date(2026, 3, 1), user)

    other_org = BuildingFactory().organization
    foreign_user = UserFactory()
    OrgMembershipFactory(user=foreign_user, organization=other_org)
    with pytest.raises(PermissionDenied):
        sell_unit(owner.unit, buyer, date(2026, 4, 1), foreign_user)
