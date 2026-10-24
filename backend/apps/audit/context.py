from contextlib import contextmanager

from django.db import connection, transaction


@contextmanager
def audit_context(actor=None, organization=None, ip='', path=''):
    with transaction.atomic():
        values = [
            str(actor.pk) if actor is not None else '',
            str(organization.pk if hasattr(organization, 'pk') else organization or ''),
            ip or '',
            path or '',
        ]
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT set_config('app.actor_id', %s, true),
                       set_config('app.organization_id', %s, true),
                       set_config('app.request_ip', %s, true),
                       set_config('app.request_path', %s, true)
                ''',
                values,
            )
        yield


class AuditContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            actor = request.user if request.user.is_authenticated else None
            with audit_context(
                actor=actor,
                ip=request.META.get('REMOTE_ADDR', ''),
                path=request.path,
            ):
                return self.get_response(request)
        return self.get_response(request)
