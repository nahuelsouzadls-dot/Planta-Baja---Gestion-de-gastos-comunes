import re
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import OrgMembership
from apps.audit.context import audit_context

from .models import LedgerEntry, Receipt, ReceiptAllocation

MAX_RECEIPT_SIZE = 10_485_760
ALLOWED_CONTENT_TYPES = {content_type for content_type, _ in Receipt.CONTENT_TYPES}


def _decimal(value):
    if isinstance(value, float):
        raise TypeError('Los montos deben ser Decimal, no float.')
    if not isinstance(value, Decimal):
        raise TypeError('Los montos deben ser Decimal.')
    return value


def assert_member(user, organization):
    if user is None or not OrgMembership.objects.filter(
        user=user, organization=organization
    ).exists():
        raise PermissionDenied('El empleado no pertenece a esta organización.')


def _occupancy_organization(occupancy):
    return occupancy.unit.building.organization


def _validate_hash(file_sha256):
    if not isinstance(file_sha256, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', file_sha256):
        raise ValidationError('El hash SHA-256 debe tener 64 caracteres hexadecimales.')


@transaction.atomic
def submit_receipt(
    person,
    uploaded_by,
    *,
    file_key,
    file_sha256,
    content_type,
    size_bytes,
    declared_amount,
    transfer_date,
    allocations,
    note='',
):
    assert_member(uploaded_by, person.organization)
    declared_amount = _decimal(declared_amount)
    if declared_amount <= 0:
        raise ValidationError('El monto declarado debe ser mayor que cero.')
    if not allocations:
        raise ValidationError('Debe indicar al menos una imputación.')
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError('El tipo de archivo no está permitido.')
    if not isinstance(size_bytes, int) or not 1 <= size_bytes <= MAX_RECEIPT_SIZE:
        raise ValidationError('El archivo debe pesar entre 1 y 10 MB.')
    _validate_hash(file_sha256)

    normalized = []
    for occupancy, amount in allocations.items():
        if (
            occupancy.person_id != person.id
            or occupancy.unit.building.organization_id != person.organization_id
        ):
            raise ValidationError('Todas las ocupaciones deben pertenecer a la persona.')
        amount = _decimal(amount)
        if amount <= 0:
            raise ValidationError('Cada imputación debe ser mayor que cero.')
        normalized.append((occupancy, amount))
    if len(normalized) > 1 and not note.strip():
        raise ValidationError('Debe indicar una aclaración cuando reparte el pago.')
    if sum((amount for _, amount in normalized), Decimal('0.00')) != declared_amount:
        raise ValidationError('La suma de las imputaciones debe coincidir con el monto declarado.')

    with audit_context(uploaded_by, organization=person.organization):
        receipt = Receipt.objects.create(
            person=person,
            uploaded_by=uploaded_by,
            file_key=file_key,
            file_sha256=file_sha256.lower(),
            content_type=content_type,
            size_bytes=size_bytes,
            declared_amount=declared_amount,
            transfer_date=transfer_date,
            note=note,
        )
        ReceiptAllocation.objects.bulk_create(
            [
                ReceiptAllocation(receipt=receipt, occupancy=occupancy, amount=amount)
                for occupancy, amount in normalized
            ]
        )
    return receipt


@transaction.atomic
def approve_receipt(receipt, user):
    locked = (
        Receipt.objects.select_for_update()
        .select_related('person__organization')
        .get(pk=receipt.pk)
    )
    allocations = list(locked.allocations.select_related('occupancy__unit__building__organization'))
    organizations = {_occupancy_organization(allocation.occupancy).id for allocation in allocations}
    if not organizations or len(organizations) != 1:
        raise ValidationError('El comprobante no tiene ocupaciones válidas.')
    organization = _occupancy_organization(allocations[0].occupancy)
    assert_member(user, organization)
    if locked.status != Receipt.Status.PENDING:
        raise ValidationError('El comprobante ya fue revisado.')

    with audit_context(user, organization=organization):
        entries = [
            LedgerEntry(
                occupancy=allocation.occupancy,
                date=locked.transfer_date,
                kind=LedgerEntry.Kind.PAYMENT,
                amount=-allocation.amount,
                receipt=locked,
                created_by=user,
                description='Transferencia verificada contra el banco',
            )
            for allocation in allocations
        ]
        LedgerEntry.objects.bulk_create(entries)
        locked.status = Receipt.Status.APPROVED
        locked.reviewed_by = user
        locked.reviewed_at = timezone.now()
        locked.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])
    return entries


@transaction.atomic
def reject_receipt(receipt, user, reason):
    locked = (
        Receipt.objects.select_for_update()
        .select_related('person__organization')
        .get(pk=receipt.pk)
    )
    assert_member(user, locked.person.organization)
    if locked.status != Receipt.Status.PENDING:
        raise ValidationError('El comprobante ya fue revisado.')
    if not reason or not reason.strip():
        raise ValidationError('El motivo del rechazo es obligatorio.')
    with audit_context(user, organization=locked.person.organization):
        locked.status = Receipt.Status.REJECTED
        locked.rejection_reason = reason.strip()
        locked.reviewed_by = user
        locked.reviewed_at = timezone.now()
        locked.save(
            update_fields=[
                'status', 'rejection_reason', 'reviewed_by', 'reviewed_at', 'updated_at'
            ]
        )
    return locked


@transaction.atomic
def record_manual_payment(occupancy, amount, on_date, user, source):
    organization = _occupancy_organization(occupancy)
    assert_member(user, organization)
    amount = _decimal(amount)
    if amount <= 0:
        raise ValidationError('El monto del pago debe ser mayor que cero.')
    if not source or not source.strip():
        raise ValidationError('La fuente de verificación es obligatoria.')
    with audit_context(user, organization=organization):
        return LedgerEntry.objects.create(
            occupancy=occupancy,
            date=on_date,
            kind=LedgerEntry.Kind.PAYMENT,
            amount=-amount,
            created_by=user,
            description=source.strip(),
        )
