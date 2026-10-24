from datetime import date

import pytest
from django.db import IntegrityError, transaction

from apps.buildings.models import Unit
from apps.people.models import Occupancy, Person
from tests.factories import (
    BuildingFactory,
    OccupancyFactory,
    OrganizationFactory,
    PersonFactory,
    UnitFactory,
)


@pytest.mark.django_db
def test_person_email_is_normalized_and_unique_per_organization():
    organization = OrganizationFactory()
    person = PersonFactory(organization=organization, email='  Ana@X.com ')
    person.refresh_from_db()
    assert person.email == 'ana@x.com'

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            PersonFactory(organization=organization, email='ANA@x.com')

    PersonFactory(organization=OrganizationFactory(), email='ANA@X.com')
    PersonFactory(organization=organization, email='')
    PersonFactory(organization=organization, email='')


@pytest.mark.django_db
def test_occupancies_overlap_only_with_same_unit_and_role():
    building = BuildingFactory()
    unit = UnitFactory(building=building, number='102')
    organization = building.organization
    first = PersonFactory(organization=organization)
    second = PersonFactory(organization=organization)
    OccupancyFactory(
        unit=unit,
        person=first,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 14),
    )

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            OccupancyFactory(
                unit=unit,
                person=second,
                role=Occupancy.Role.TENANT,
                start_date=date(2026, 3, 14),
            )

    OccupancyFactory(
        unit=unit,
        person=second,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 3, 15),
    )
    OccupancyFactory(
        unit=unit,
        person=first,
        role=Occupancy.Role.OWNER,
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 14),
    )
    OccupancyFactory(
        unit=UnitFactory(building=building, number='103'),
        person=second,
        role=Occupancy.Role.TENANT,
        start_date=date(2026, 3, 1),
    )


@pytest.mark.django_db
def test_open_occupancy_overlaps_future_occupancy():
    occupancy = OccupancyFactory(
        start_date=date(2026, 1, 1),
        end_date=None,
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            OccupancyFactory(
                unit=occupancy.unit,
                person=PersonFactory(organization=occupancy.person.organization),
                role=occupancy.role,
                start_date=date(2026, 6, 1),
            )


@pytest.mark.django_db
def test_direct_insert_is_protected_by_exclusion_constraint():
    occupancy = OccupancyFactory(
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 14),
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Occupancy.objects.create(
                unit=occupancy.unit,
                person=PersonFactory(organization=occupancy.person.organization),
                role=occupancy.role,
                start_date=date(2026, 3, 14),
            )
