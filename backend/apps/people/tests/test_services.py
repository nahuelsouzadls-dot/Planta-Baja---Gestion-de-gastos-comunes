from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import PermissionDenied, ValidationError

from apps.people.models import Occupancy
from apps.people.services import (
    current_occupancy,
    days_in_month,
    move_in,
    move_out,
    occupancies_in_month,
    owner_gaps,
    sell_unit,
)
from apps.ledger.models import LedgerEntry
from apps.ledger.services import record_opening
from tests.factories import (
    BuildingFactory, OccupancyFactory, OrgMembershipFactory, PersonFactory, UnitFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


@pytest.mark.django_db
def test_move_in_rejects_person_from_another_organization():
    unit = UnitFactory()
    person = PersonFactory()
    with pytest.raises(ValidationError, match='misma organización'):
        move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1))


@pytest.mark.django_db
def test_move_in_translates_overlap_integrity_error():
    unit = UnitFactory()
    person = PersonFactory(organization=unit.building.organization)
    other = PersonFactory(organization=unit.building.organization)
    move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1))
    with pytest.raises(ValidationError, match='unidad'):
        move_in(unit, other, Occupancy.Role.TENANT, date(2026, 3, 15))


@pytest.mark.django_db
def test_move_out_only_closes_current_tenant():
    owner = OccupancyFactory(role=Occupancy.Role.OWNER, end_date=None)
    with pytest.raises(ValidationError, match='propietario'):
        move_out(owner, date(2026, 3, 10))

    tenant = OccupancyFactory(role=Occupancy.Role.TENANT, start_date=date(2026, 3, 1))
    move_out(tenant, date(2026, 3, 14))
    with pytest.raises(ValidationError, match='cerrada'):
        move_out(tenant, date(2026, 3, 15))

    open_tenant = OccupancyFactory(role=Occupancy.Role.TENANT, start_date=date(2026, 3, 10))
    with pytest.raises(ValidationError, match='anterior'):
        move_out(open_tenant, date(2026, 3, 9))


@pytest.mark.django_db
def test_current_occupancy_and_days_in_month_use_inclusive_dates():
    unit = UnitFactory()
    person = PersonFactory(organization=unit.building.organization)
    occupancy = move_in(unit, person, Occupancy.Role.TENANT, date(2026, 3, 1))
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
    occupancy = move_in(unit, owner, Occupancy.Role.OWNER, date(2026, 1, 1))
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
