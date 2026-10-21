from rest_framework.viewsets import ModelViewSet

from .models import Apartment, Building
from .serializers import ApartmentSerializer, BuildingSerializer


class BuildingViewSet(ModelViewSet):
    queryset = Building.objects.all()
    serializer_class = BuildingSerializer


class ApartmentViewSet(ModelViewSet):
    queryset = Apartment.objects.select_related('building').all()
    serializer_class = ApartmentSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        building_id = self.request.query_params.get('building_id')
        if building_id:
            qs = qs.filter(building_id=building_id)
        return qs
