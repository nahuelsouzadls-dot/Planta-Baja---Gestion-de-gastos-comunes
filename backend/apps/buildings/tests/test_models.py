from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.buildings.models import ExpenseConcept, Unit
from tests.factories import BuildingFactory, ExpenseConceptFactory, UnitFactory


@pytest.mark.django_db
def test_create_building_creates_default_concepts():
    from apps.buildings.services import DEFAULT_CONCEPTS, create_building
    from tests.factories import OrganizationFactory

    building = create_building(
        OrganizationFactory(),
        name='Edificio Minas',
        address='Minas 1234',
    )

    concepts = list(building.concepts.all())
    assert len(concepts) == 6
    assert [
        (concept.name, concept.kind, concept.is_reserve_fund)
        for concept in concepts
    ] == DEFAULT_CONCEPTS
    assert sum(concept.is_reserve_fund for concept in concepts) == 1


@pytest.mark.django_db
def test_unit_number_is_unique_per_building_but_not_globally():
    building = BuildingFactory()
    UnitFactory(building=building, number='101')

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            UnitFactory(building=building, number='101')

    other_building = BuildingFactory()
    UnitFactory(building=other_building, number='101')


@pytest.mark.django_db
@pytest.mark.parametrize('coefficient', [Decimal('0'), Decimal('1.000001')])
def test_unit_coefficient_must_be_between_zero_and_one(coefficient):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            UnitFactory(coefficient=coefficient)


@pytest.mark.django_db
@pytest.mark.parametrize('due_day', [0, 29])
def test_building_due_day_must_be_between_one_and_28(due_day):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            BuildingFactory(due_day=due_day)


@pytest.mark.django_db
def test_only_one_reserve_fund_per_building():
    building = BuildingFactory()
    ExpenseConceptFactory(
        building=building,
        name='Fondo de reserva',
        kind=ExpenseConcept.Kind.OWNER_ONLY,
        is_reserve_fund=True,
    )

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ExpenseConceptFactory(
                building=building,
                name='Otro fondo',
                kind=ExpenseConcept.Kind.OWNER_ONLY,
                is_reserve_fund=True,
            )


@pytest.mark.django_db
def test_reserve_fund_must_be_owner_only():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ExpenseConceptFactory(
                kind=ExpenseConcept.Kind.ORDINARY,
                is_reserve_fund=True,
            )


@pytest.mark.django_db
def test_validate_coefficients_for_edificio_minas():
    from apps.buildings.services import coefficient_sum, validate_coefficients

    building = BuildingFactory(name='Edificio Minas')
    coefficients = [
        '0.086', '0.083', '0.080', '0.084',
        '0.086', '0.083', '0.080', '0.084',
        '0.087', '0.083', '0.080', '0.084',
    ]
    numbers = ['101', '102', '103', '201', '202', '203', '301', '302', '303', '401', '402', '304']
    for number, coefficient in zip(numbers, coefficients):
        UnitFactory(
            building=building,
            number=number,
            coefficient=coefficient,
        )

    assert coefficient_sum(building) == Decimal('1.000000')
    validate_coefficients(building)

    building.units.get(number='304').delete()
    with pytest.raises(ValidationError, match=r'0\.916'):
        validate_coefficients(building)


@pytest.mark.django_db
def test_coefficient_is_stored_as_decimal_without_precision_loss():
    unit = UnitFactory(coefficient=Decimal('0.086'))
    unit.refresh_from_db()

    assert isinstance(unit.coefficient, Decimal)
    assert unit.coefficient == Decimal('0.086000')
