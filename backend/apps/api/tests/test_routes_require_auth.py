import re

import pytest
from django.http import JsonResponse
from django.test import override_settings
from django.urls import include, path
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient


PUBLIC_ROUTES = {
    'auth/csrf',
    'auth/login',
    'auth/password-reset',
    'auth/password-reset/confirm',
    'invitations/accept',
}


def api_routes(patterns, prefix=''):
    for pattern in patterns:
        route_pattern = getattr(pattern.pattern, '_route', pattern.pattern._regex)
        route = f'{prefix}{route_pattern}'
        if isinstance(pattern, URLResolver):
            yield from api_routes(pattern.url_patterns, route)
        elif isinstance(pattern, URLPattern):
            yield route


def concrete_route(route):
    return re.sub(r'<(?:[^:>]+:)?[^>]+>', '00000000-0000-0000-0000-000000000000', route)


def assert_api_routes_are_protected(patterns, prefix=''):
    for pattern in patterns:
        route_pattern = getattr(pattern.pattern, '_route', pattern.pattern._regex)
        route = f'{prefix}{route_pattern}'
        if isinstance(pattern, URLResolver):
            assert_api_routes_are_protected(pattern.url_patterns, route)
            continue
        if not route.startswith('api/v1/') or route.removeprefix('api/v1/') in PUBLIC_ROUTES:
            continue
        view_class = getattr(pattern.callback, 'view_class', None)
        permission_classes = getattr(view_class, 'permission_classes', ())
        assert permission_classes, route
        assert all(permission.__name__ != 'AllowAny' for permission in permission_classes), route


@pytest.mark.django_db
def test_all_non_public_api_routes_require_authentication():
    client = APIClient(enforce_csrf_checks=True)
    routes = [
        route.removeprefix('api/v1/')
        for route in api_routes(get_resolver().url_patterns)
        if route.startswith('api/v1/')
    ]
    protected = [route for route in routes if route not in PUBLIC_ROUTES]
    assert protected
    for route in protected:
        response = client.get(f'/api/v1/{concrete_route(route)}')
        assert response.status_code == 403, route
    assert_api_routes_are_protected(get_resolver().url_patterns)


@pytest.mark.django_db
def test_route_guard_detects_unprotected_api_view():
    def unprotected_view(request):
        return JsonResponse({'ok': True})

    test_urlpatterns = [
        path('api/v1/', include('apps.api.v1.auth')),
        path('api/v1/', include('apps.api.v1.permissions')),
        path('api/v1/unprotected', unprotected_view),
    ]
    with override_settings(ROOT_URLCONF=type('TestUrls', (), {'urlpatterns': test_urlpatterns})):
        with pytest.raises(AssertionError, match='api/v1/unprotected'):
            assert_api_routes_are_protected(test_urlpatterns)
