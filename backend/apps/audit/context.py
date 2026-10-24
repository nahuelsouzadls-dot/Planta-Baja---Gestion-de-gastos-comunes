from contextlib import contextmanager

from django.db import connection, transaction

from apps.core.net import client_ip


@contextmanager
def audit_context(actor=None, organization=None, ip=None, path=None):
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT current_setting('app.actor_id', true),
                       current_setting('app.organization_id', true),
                       current_setting('app.request_ip', true),
                       current_setting('app.request_path', true)
                '''
            )
            previous = cursor.fetchone()
            values = [
                (
                    str(actor.pk)
                    if actor is not None and getattr(actor, 'pk', None)
                    else '' if actor is not None else previous[0] or ''
                ),
                (
                    str(organization.pk if hasattr(organization, 'pk') else organization)
                    if organization is not None
                    else previous[1] or ''
                ),
                ip if ip is not None else previous[2] or '',
                path if path is not None else previous[3] or '',
            ]
            cursor.execute(
                '''
                SELECT set_config('app.actor_id', %s, true),
                       set_config('app.organization_id', %s, true),
                       set_config('app.request_ip', %s, true),
                       set_config('app.request_path', %s, true)
                ''',
                values,
            )
        try:
            yield
        finally:
            with connection.cursor() as cursor:
                cursor.execute(
                    '''
                    SELECT set_config('app.actor_id', %s, true),
                           set_config('app.organization_id', %s, true),
                           set_config('app.request_ip', %s, true),
                           set_config('app.request_path', %s, true)
                    ''',
                    [value or '' for value in previous],
                )


class AuditContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            actor = request.user if request.user.is_authenticated else None
            with audit_context(
                actor=actor,
                ip=client_ip(request),
                path=request.path,
            ):
                return self.get_response(request)
        return self.get_response(request)
