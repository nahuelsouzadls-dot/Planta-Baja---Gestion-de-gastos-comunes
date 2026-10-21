import pytest

from apps.residents.models import Resident


@pytest.mark.django_db
class TestResidentModel:
    def test_building_property(self, owner_resident):
        assert owner_resident.building == owner_resident.apartment.building

    def test_role_choices(self, owner_resident, tenant_resident):
        assert owner_resident.role == Resident.Role.OWNER
        assert tenant_resident.role == Resident.Role.TENANT

    def test_str_includes_role_and_apartment(self, owner_resident):
        result = str(owner_resident)
        assert 'Propietario' in result
