from rest_framework.viewsets import ModelViewSet

from .models import Resident
from .serializers import ResidentSerializer


class ResidentViewSet(ModelViewSet):
    queryset = Resident.objects.select_related('user', 'apartment__building').all()
    serializer_class = ResidentSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        building_id = self.request.query_params.get('building_id')
        apartment_id = self.request.query_params.get('apartment_id')
        if building_id:
            qs = qs.filter(apartment__building_id=building_id)
        if apartment_id:
            qs = qs.filter(apartment_id=apartment_id)
        return qs
