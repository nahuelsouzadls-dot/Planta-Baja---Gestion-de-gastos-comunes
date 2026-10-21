from rest_framework import status
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import Movement
from .serializers import MovementSerializer


class MovementViewSet(ModelViewSet):
    queryset = Movement.objects.select_related(
        'resident__user', 'resident__apartment__building', 'monthly_expense',
    ).all()
    serializer_class = MovementSerializer

    def update(self, request, *args, **kwargs):
        return Response(
            {'detail': 'Los movimientos son inmutables. Crea un asiento de ajuste.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        building_id = self.request.query_params.get('building_id')
        resident_id = self.request.query_params.get('resident_id')
        if building_id:
            qs = qs.filter(resident__apartment__building_id=building_id)
        if resident_id:
            qs = qs.filter(resident_id=resident_id)
        return qs
