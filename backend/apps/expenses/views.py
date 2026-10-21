from rest_framework.viewsets import ModelViewSet

from .models import MonthlyExpense
from .serializers import MonthlyExpenseSerializer


class MonthlyExpenseViewSet(ModelViewSet):
    queryset = MonthlyExpense.objects.select_related('building').all()
    serializer_class = MonthlyExpenseSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        building_id = self.request.query_params.get('building_id')
        if building_id:
            qs = qs.filter(building_id=building_id)
        return qs
