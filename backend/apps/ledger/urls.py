from rest_framework.routers import DefaultRouter

from .views import MovementViewSet

router = DefaultRouter()
router.register('', MovementViewSet, basename='movement')

urlpatterns = router.urls
