from django.urls import path

from apps.frontend import views

urlpatterns = [
    path('', views.root, name='front-root'),
    path('panel', views.panel, name='front-panel'),
    path('portal', views.portal, name='front-portal'),
    path('ingresar', views.login_resident, name='front-login'),
    path('ingresar/administracion', views.login_admin, name='front-login-admin'),
    path('aceptar-invitacion', views.accept_invitation, name='front-accept-invitation'),
    path('recuperar-contrasena', views.password, name='front-password-reset'),
    path('restablecer-contrasena', views.password, name='front-password-reset-confirm'),
]
