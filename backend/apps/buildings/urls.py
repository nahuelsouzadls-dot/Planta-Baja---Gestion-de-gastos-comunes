from rest_framework.routers import DefaultRouter

from .views import ApartmentViewSet, BuildingViewSet

router = DefaultRouter()
# 'apartments' must be registered before '' so it isn't captured as a building pk.
router.register('apartments', ApartmentViewSet, basename='apartment')
router.register('', BuildingViewSet, basename='building')

urlpatterns = router.urls
