from django.urls import path

from apps.api.v1.scoping_views import (
    BuildingDetailView,
    OrganizationBuildingListView,
    OrganizationListView,
    ResidentOccupancyListView,
)


urlpatterns = [
    path('organizations', OrganizationListView.as_view(), name='organization-list'),
    path(
        'organizations/<uuid:organization_id>/buildings',
        OrganizationBuildingListView.as_view(),
        name='organization-building-list',
    ),
    path(
        'buildings/<uuid:building_id>',
        BuildingDetailView.as_view(),
        name='building-detail',
    ),
    path(
        'portal/occupancies',
        ResidentOccupancyListView.as_view(),
        name='resident-occupancy-list',
    ),
]
