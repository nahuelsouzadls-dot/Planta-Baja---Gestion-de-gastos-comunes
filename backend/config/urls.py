from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.api.permissions import IsEmployee

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include('apps.api.v1.auth')),
    path('api/v1/', include('apps.api.v1.permissions')),
    path('api/v1/schema', SpectacularAPIView.as_view(permission_classes=[IsEmployee]), name='schema'),
    path('api/v1/docs', SpectacularSwaggerView.as_view(url_name='schema', permission_classes=[IsEmployee]), name='docs'),
]
