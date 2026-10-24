import re
from urllib.parse import urlsplit

from rest_framework.test import APIClient

_UUID_RE = re.compile(
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    re.IGNORECASE,
)


def api_client_for(user):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    response = client.get('/api/v1/auth/csrf')
    assert response.status_code == 204
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
    return client


def assert_cross_org_404(client, url, method='get', **kwargs):
    response = getattr(client, method.lower())(url, **kwargs)
    assert response.status_code == 404
    body = response.content.decode('utf-8').lower()
    path = urlsplit(url).path.rstrip('/')
    tokens = {
        *(match.lower() for match in _UUID_RE.findall(url)),
        path.rsplit('/', 1)[-1].lower(),
    }
    for token in tokens:
        if token:
            assert token not in body
    return response
