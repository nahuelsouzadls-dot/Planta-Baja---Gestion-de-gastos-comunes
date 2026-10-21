from rest_framework.routers import DefaultRouter

from .views import MonthlyExpenseViewSet

router = DefaultRouter()
router.register('', MonthlyExpenseViewSet, basename='monthly-expense')

urlpatterns = router.urls
