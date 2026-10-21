from rest_framework.routers import DefaultRouter

from .views import ResidentViewSet

router = DefaultRouter()
router.register('', ResidentViewSet, basename='resident')

urlpatterns = router.urls
