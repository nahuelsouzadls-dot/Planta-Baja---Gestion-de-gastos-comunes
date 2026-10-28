from django.urls import path, re_path

from apps.frontend import views

urlpatterns = [
    path('', views.root, name='front-root'),
    # El panel y el portal tienen subrutas propias del front (/panel/edificio/<id>/<pestaña>).
    re_path(r'^panel(?:/(?P<rest>.*))?$', views.panel, name='front-panel'),
    re_path(r'^portal(?:/(?P<rest>.*))?$', views.portal, name='front-portal'),
    path('ingresar', views.public, name='front-login'),
    path('ingresar/administracion', views.public, name='front-login-admin'),
    path('aceptar-invitacion', views.public, name='front-accept-invitation'),
    path('recuperar-contrasena', views.public, name='front-password-reset'),
    path('restablecer-contrasena', views.public, name='front-password-reset-confirm'),
]
