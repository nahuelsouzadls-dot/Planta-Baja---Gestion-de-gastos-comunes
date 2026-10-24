import re
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import OrgMembership
from apps.audit.context import audit_context
from apps.audit.events import record_event
from apps.core.money import format_money, to_money

from .models import LedgerEntry, Receipt, ReceiptAllocation

MAX_RECEIPT_SIZE = 10_485_760
ALLOWED_CONTENT_TYPES = {content_type for content_type, _ in Receipt.CONTENT_TYPES}


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
    if uploaded_by is None or (
        getattr(person, 'user_id', None) != uploaded_by.id
        and not OrgMembership.objects.filter(
            user=uploaded_by, organization=person.organization
        ).exists()
    ):
        raise PermissionDenied('No está autorizado a subir este comprobante.')
    declared_amount = to_money(declared_amount)
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
        amount = to_money(amount)
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
def approve_receipt(receipt, user, allocations=None):
    locked = (
        Receipt.objects.select_for_update()
        .select_related('person__organization')
        .get(pk=receipt.pk)
    )
    original_allocations = list(
        locked.allocations.select_related('occupancy__unit__building__organization')
    )
    organizations = {
        _occupancy_organization(allocation.occupancy).id for allocation in original_allocations
    }
    if not organizations or len(organizations) != 1:
        raise ValidationError('El comprobante no tiene ocupaciones válidas.')
    organization = _occupancy_organization(original_allocations[0].occupancy)
    assert_member(user, organization)
    if locked.status != Receipt.Status.PENDING:
        raise ValidationError('El comprobante ya fue revisado.')

    if allocations is None:
        final_allocations = [(allocation.occupancy, allocation.amount) for allocation in original_allocations]
    else:
        if not allocations:
            raise ValidationError('Debe indicar al menos una imputación.')
        final_allocations = []
        for occupancy, amount in allocations.items():
            if (
                occupancy.person_id != locked.person_id
                or occupancy.unit.building.organization_id != organization.id
            ):
                raise ValidationError('Todas las ocupaciones deben pertenecer a la persona.')
            amount = to_money(amount)
            if amount <= 0:
                raise ValidationError('Cada imputación debe ser mayor que cero.')
            final_allocations.append((occupancy, amount))
        if len(final_allocations) > 1 and not locked.note.strip():
            raise ValidationError('Debe indicar una aclaración cuando reparte el pago.')
        if sum((amount for _, amount in final_allocations), Decimal('0.00')) != locked.declared_amount:
            raise ValidationError('La suma de las imputaciones debe coincidir con el monto declarado.')

    with audit_context(user, organization=organization):
        if allocations is not None:
            locked.allocations.all().delete()
            ReceiptAllocation.objects.bulk_create(
                [
                    ReceiptAllocation(receipt=locked, occupancy=occupancy, amount=amount)
                    for occupancy, amount in final_allocations
                ]
            )
        entries = [
            LedgerEntry(
                occupancy=occupancy,
                date=locked.transfer_date,
                kind=LedgerEntry.Kind.PAYMENT,
                amount=-amount,
                receipt=locked,
                created_by=user,
                description='Transferencia verificada contra el banco',
            )
            for occupancy, amount in final_allocations
        ]
        LedgerEntry.objects.bulk_create(entries)
        locked.status = Receipt.Status.APPROVED
        locked.reviewed_by = user
        locked.reviewed_at = timezone.now()
        locked.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])
        first_occupancy = final_allocations[0][0]
        record_event(
            user,
            organization,
            'receipt.approve',
            locked,
            (
                f'Aprobó el comprobante de {locked.person} '
                f'(apto {first_occupancy.unit.number}) por {format_money(locked.declared_amount)}'
            ),
            amount=str(locked.declared_amount),
            unit=first_occupancy.unit.number,
        )
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
    first_allocation = locked.allocations.select_related('occupancy__unit').first()
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
        record_event(
            user,
            locked.person.organization,
            'receipt.reject',
            locked,
            (
                f'Rechazó el comprobante de {locked.person}: '
                f'{locked.rejection_reason}'
                + (
                    f' (apto {first_allocation.occupancy.unit.number})'
                    if first_allocation is not None else ''
                )
            ),
            reason=locked.rejection_reason,
            unit=first_allocation.occupancy.unit.number if first_allocation is not None else None,
        )
    return locked


@transaction.atomic
def record_manual_payment(occupancy, amount, on_date, user, source):
    organization = _occupancy_organization(occupancy)
    assert_member(user, organization)
    amount = to_money(amount)
    if amount <= 0:
        raise ValidationError('El monto del pago debe ser mayor que cero.')
    if not source or not source.strip():
        raise ValidationError('La fuente de verificación es obligatoria.')
    with audit_context(user, organization=organization):
        entry = LedgerEntry.objects.create(
            occupancy=occupancy,
            date=on_date,
            kind=LedgerEntry.Kind.PAYMENT,
            amount=-amount,
            created_by=user,
            description=source.strip(),
        )
        record_event(
            user,
            organization,
            'payment.record_manual',
            entry,
            (
                f'Registró un pago sin comprobante de {format_money(amount)} '
                f'para el apto {occupancy.unit.number} (fuente: {source.strip()})'
            ),
            amount=str(amount),
            unit=occupancy.unit.number,
            source=source.strip(),
        )
        return entry
