from rest_framework.routers import DefaultRouter

from .views import ApartmentViewSet, BuildingViewSet

router = DefaultRouter()
router.register('', BuildingViewSet, basename='building')
router.register('apartments', ApartmentViewSet, basename='apartment')

urlpatterns = router.urls
