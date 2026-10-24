from django.utils import timezone
from rest_framework.generics import ListAPIView, RetrieveAPIView

from apps.api.permissions import IsEmployee, IsResident
from apps.api.scoping import (
    employee_buildings,
    employee_organizations,
    get_in_scope_or_404,
    resident_occupancies,
)
from apps.api.v1.scoping import (
    BuildingDetailSerializer,
    BuildingListSerializer,
    OccupancySerializer,
    OrganizationSerializer,
)
from apps.buildings.models import Building


class OrganizationListView(ListAPIView):
    permission_classes = [IsEmployee]
    serializer_class = OrganizationSerializer
    pagination_class = None

    def get_queryset(self):
        return employee_organizations(self.request.user)


class OrganizationBuildingListView(ListAPIView):
    permission_classes = [IsEmployee]
    serializer_class = BuildingListSerializer
    pagination_class = None

    def get_queryset(self):
        organization = get_in_scope_or_404(
            employee_organizations(self.request.user), self.kwargs['organization_id']
        )
        return Building.objects.filter(organization=organization).prefetch_related('units')


class BuildingDetailView(RetrieveAPIView):
    permission_classes = [IsEmployee]
    serializer_class = BuildingDetailSerializer

    def get_object(self):
        return get_in_scope_or_404(
            employee_buildings(self.request.user).prefetch_related('units'),
            self.kwargs['building_id'],
        )


class ResidentOccupancyListView(ListAPIView):
    permission_classes = [IsResident]
    serializer_class = OccupancySerializer
    pagination_class = None

    def get_queryset(self):
        return resident_occupancies(
            self.request.user, on_date=timezone.localdate()
        ).select_related('unit', 'unit__building')
