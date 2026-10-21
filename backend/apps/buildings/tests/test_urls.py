import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.buildings.models import Apartment


@pytest.mark.django_db
class TestBuildingRoutes:
    def test_apartments_list_is_not_captured_as_building_detail(self, apartment):
        response = APIClient().get('/api/v1/buildings/apartments/')
        assert response.status_code == 200
        assert response.json()['count'] == 1

    def test_building_detail(self, building):
        response = APIClient().get(f'/api/v1/buildings/{building.id}/')
        assert response.status_code == 200
        assert response.json()['name'] == 'Edificio Confort'


@pytest.mark.django_db
class TestSeedData:
    def test_seed_runs_and_coefficients_sum_to_one(self):
        call_command('seed_data', stdout=open('/dev/null', 'w'))
        total = sum(a.ownership_coefficient for a in Apartment.objects.all())
        assert Apartment.objects.count() == 12
        assert total == 1
