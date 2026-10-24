from collections.abc import Mapping

from .models import AuditLog


_FORBIDDEN_KEYS = {'email', 'document', 'phone', 'password'}


def _validate_data(value):
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if key in _FORBIDDEN_KEYS:
                raise ValueError(f'La clave {key!r} no puede guardarse en un evento.')
            _validate_data(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            _validate_data(nested)


def record_event(actor, organization, action, target, summary, **data) -> AuditLog:
    if actor is None:
        raise ValueError('El actor es obligatorio.')
    if not summary or len(summary) > 300:
        raise ValueError('El resumen debe tener entre 1 y 300 caracteres.')
    _validate_data(data)
    return AuditLog.objects.create(
        actor=actor,
        organization=organization,
        action=action,
        target_type=target._meta.label_lower,
        target_id=target.pk,
        summary=summary,
        data=data,
    )
