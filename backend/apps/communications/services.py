from datetime import date

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.ledger.payments import assert_member
from apps.people.models import Occupancy, Person

from .models import Claim, ClaimMessage, Notice, Task


def _organization_for_building(building):
    return building.organization


def _validate_length(value, minimum, maximum, label):
    value = value.strip()
    if not minimum <= len(value) <= maximum:
        raise ValidationError(
            f'{label} debe tener entre {minimum} y {maximum} caracteres.'
        )
    return value


@transaction.atomic
def publish_notice(building, user, title, body):
    organization = _organization_for_building(building)
    assert_member(user, organization)
    title = _validate_length(title, 3, 120, 'El título')
    body = _validate_length(body, 10, 1200, 'El cuerpo')
    with audit_context(user, organization=organization):
        notice = Notice.objects.create(
            building=building,
            title=title,
            body=body,
            published_by=user,
        )
        record_event(
            user,
            organization,
            'notice.publish',
            notice,
            f'Publicó el aviso «{title}»',
            title=title,
            building=building.name,
        )
        return notice


@transaction.atomic
def reply_as_admin(claim, user, text):
    locked_claim = Claim.objects.select_for_update().select_related(
        'building__organization'
    ).get(pk=claim.pk)
    organization = locked_claim.building.organization
    assert_member(user, organization)
    text = _validate_length(text, 1, 1000, 'El mensaje')
    with audit_context(user, organization=organization):
        message = ClaimMessage.objects.create(
            claim=locked_claim,
            author=user,
            from_admin=True,
            text=text,
        )
        if locked_claim.status == Claim.Status.PENDING:
            locked_claim.status = Claim.Status.IN_PROGRESS
            locked_claim.save(update_fields=['status', 'updated_at'])
    return message


@transaction.atomic
def set_claim_status(claim, user, status):
    locked_claim = Claim.objects.select_for_update().select_related(
        'building__organization'
    ).get(pk=claim.pk)
    organization = locked_claim.building.organization
    assert_member(user, organization)
    valid_statuses = {choice for choice, _ in Claim.Status.choices}
    if status not in valid_statuses:
        raise ValidationError('El estado del reclamo no es válido.')
    valid_transitions = {
        Claim.Status.PENDING: {Claim.Status.IN_PROGRESS, Claim.Status.RESOLVED},
        Claim.Status.IN_PROGRESS: {Claim.Status.RESOLVED},
        Claim.Status.RESOLVED: {Claim.Status.IN_PROGRESS},
    }
    if status not in valid_transitions[locked_claim.status]:
        raise ValidationError('La transición del reclamo no es válida.')
    with audit_context(user, organization=organization):
        locked_claim.status = status
        locked_claim.save(update_fields=['status', 'updated_at'])
        record_event(
            user,
            organization,
            'claim.status',
            locked_claim,
            (
                f'Cambió el estado del reclamo «{locked_claim.title}» '
                f'a {locked_claim.get_status_display()}'
            ),
            status=status,
            title=locked_claim.title,
            unit=locked_claim.unit.number,
        )
    return locked_claim


@transaction.atomic
def create_task(organization, building, user, text, due_date=None):
    if building.organization_id != organization.id:
        raise ValidationError('El edificio no pertenece a la organización.')
    assert_member(user, organization)
    text = _validate_length(text, 1, 90, 'La tarea')
    with audit_context(user, organization=organization):
        return Task.objects.create(
            organization=organization,
            building=building,
            text=text,
            due_date=due_date,
            created_by=user,
        )


@transaction.atomic
def toggle_task(task, user):
    locked_task = Task.objects.select_for_update().select_related(
        'organization'
    ).get(pk=task.pk)
    assert_member(user, locked_task.organization)
    with audit_context(user, organization=locked_task.organization):
        locked_task.done = not locked_task.done
        locked_task.save(update_fields=['done', 'updated_at'])
    return locked_task


def _current_occupancy(person, unit, on_date):
    return Occupancy.objects.filter(
        person=person,
        unit=unit,
        start_date__lte=on_date,
    ).filter(
        Q(end_date__isnull=True) | Q(end_date__gte=on_date)
    ).exists()


@transaction.atomic
def open_claim(person, unit, kind, title, body, user):
    if user is None or person.user_id != user.id:
        raise PermissionDenied('La persona no está autorizada para este reclamo.')
    if person.organization_id != unit.building.organization_id:
        raise PermissionDenied('La persona no pertenece a este edificio.')
    if not _current_occupancy(person, unit, timezone.localdate()):
        raise PermissionDenied('La persona no ocupa actualmente esta unidad.')
    if kind not in {choice for choice, _ in Claim.Kind.choices}:
        raise ValidationError('El tipo de reclamo no es válido.')
    title = _validate_length(title, 4, 120, 'El título')
    body = body.strip()
    with audit_context(user, organization=person.organization):
        claim = Claim.objects.create(
            building=unit.building,
            unit=unit,
            author=person,
            kind=kind,
            title=title,
        )
        ClaimMessage.objects.create(
            claim=claim,
            author=user,
            from_admin=False,
            text=body or title,
        )
    return claim


@transaction.atomic
def reply_as_resident(claim, person, user, text):
    locked_claim = Claim.objects.select_for_update().select_related(
        'building__organization'
    ).get(pk=claim.pk)
    if user is None or person.user_id != user.id or locked_claim.author_id != person.id:
        raise PermissionDenied('La persona no está autorizada para este reclamo.')
    if locked_claim.status == Claim.Status.RESOLVED:
        raise ValidationError(
            'Este reclamo está resuelto. Si el problema sigue, abrí uno nuevo.'
        )
    text = _validate_length(text, 1, 1000, 'El mensaje')
    with audit_context(user, organization=locked_claim.building.organization):
        return ClaimMessage.objects.create(
            claim=locked_claim,
            author=user,
            from_admin=False,
            text=text,
        )
