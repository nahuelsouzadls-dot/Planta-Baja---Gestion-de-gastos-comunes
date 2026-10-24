from django.conf import settings


def test_drf_requires_authenticated_session_by_default():
    assert settings.REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'] == [
        'rest_framework.permissions.IsAuthenticated',
    ]
    assert settings.REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES'] == [
        'rest_framework.authentication.SessionAuthentication',
    ]
