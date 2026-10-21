from decimal import Decimal

import pytest
from django.db import IntegrityError

from apps.buildings.models import Apartment, Building


@pytest.mark.django_db
class TestBuildingModel:
    def test_create_building_and_str(self):
        building = Building.objects.create(
            name='Edificio Confort',
            address='Av. Brasil 2234',
        )
        assert str(building) == 'Edificio Confort — Av. Brasil 2234'

    def test_default_city_and_country(self):
        building = Building.objects.create(name='Test', address='Test 123')
        assert building.city == 'Montevideo'
        assert building.country == 'Uruguay'


@pytest.mark.django_db
class TestApartmentModel:
    def test_ownership_coefficient_is_decimal(self, building):
        apt = Apartment.objects.create(
            building=building,
            number='101',
            floor=1,
            ownership_coefficient=Decimal('0.08333333'),
        )
        assert isinstance(apt.ownership_coefficient, Decimal)
        assert apt.ownership_coefficient == Decimal('0.08333333')

    def test_unique_together_building_number(self, building):
        Apartment.objects.create(
            building=building,
            number='101',
            floor=1,
            ownership_coefficient=Decimal('0.08333333'),
        )
        with pytest.raises(IntegrityError):
            Apartment.objects.create(
                building=building,
                number='101',
                floor=2,
                ownership_coefficient=Decimal('0.08333333'),
            )

    def test_ordering_by_floor_then_number(self, building):
        Apartment.objects.create(building=building, number='301', floor=3, ownership_coefficient=Decimal('0.08'))
        Apartment.objects.create(building=building, number='101', floor=1, ownership_coefficient=Decimal('0.08'))
        Apartment.objects.create(building=building, number='201', floor=2, ownership_coefficient=Decimal('0.08'))
        Apartment.objects.create(building=building, number='102', floor=1, ownership_coefficient=Decimal('0.08'))

        apartments = list(Apartment.objects.filter(building=building).values_list('number', flat=True))
        assert apartments == ['101', '102', '201', '301']

    def test_str(self, building):
        apt = Apartment.objects.create(
            building=building,
            number='202',
            floor=2,
            ownership_coefficient=Decimal('0.08333333'),
        )
        assert 'Apto 202' in str(apt)
        assert building.name in str(apt)
