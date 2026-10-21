from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/buildings/', include('apps.buildings.urls')),
    path('api/v1/residents/', include('apps.residents.urls')),
    path('api/v1/expenses/', include('apps.expenses.urls')),
    path('api/v1/ledger/', include('apps.ledger.urls')),
]
