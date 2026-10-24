import re

import pytest
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
