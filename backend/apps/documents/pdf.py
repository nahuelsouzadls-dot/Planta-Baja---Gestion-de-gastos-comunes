"""PDF de la liquidación (D4): requisito duro del cliente para residentes que reciben papel.

Se genera la primera vez que alguien lo pide y queda guardado en el almacenamiento con su
sha256. Es inmutable: el mismo mes y la misma cuenta devuelven siempre el mismo archivo.
Cuando exista el worker (D2), se podrá generar al emitir en lugar de a pedido.
"""
import hashlib
import uuid
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.template.loader import render_to_string
from django.utils import timezone
from weasyprint import HTML

from apps.core.money import format_money
from apps.documents import data
from apps.documents.models import SettlementDocument
from apps.ledger.accounts import portal_settlement_detail
from apps.ledger.models import LedgerEntry
from apps.storage import services as storage

ROLE_LABEL = {'owner': 'Propietario', 'tenant': 'Inquilino'}
MONTHS = ('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
          'setiembre', 'octubre', 'noviembre', 'diciembre')


def month_label(month):
    return f'{MONTHS[month.month - 1]} {month.year}'


def _user_name(user):
    if user is None:
        return ''
    return f'{user.first_name} {user.last_name}'.strip() or user.email


def previous_balance(settlement, occupancy):
    """Saldo de la cuenta el día que se emitió, sin los cargos de esta liquidación.

    Se fija en la emisión, así el PDF da lo mismo aunque se genere semanas después.
    """
    issued_on = timezone.localtime(settlement.issued_at).date() if settlement.issued_at else settlement.month
    return (
        LedgerEntry.objects.filter(occupancy=occupancy, date__lte=issued_on)
        .exclude(settlement=settlement)
        .aggregate(total=Sum('amount'))['total']
        or Decimal('0')
    )


def _common(settlement):
    building = settlement.building
    return {
        'organization': building.organization.name,
        'building': building,
        'month_label': month_label(settlement.month),
        'due_day': building.due_day,
        'issued_by': _user_name(settlement.issued_by),
        'issued_at': timezone.localtime(settlement.issued_at) if settlement.issued_at else None,
        'generated_at': timezone.localtime(),
        'bank': {
            'name': building.bank_name,
            'account': building.bank_account,
            'holder': building.bank_holder or building.organization.name,
        },
    }


def building_html(settlement):
    items = data.settlement_items(settlement)
    charges = data.settlement_charges(settlement)
    return render_to_string('documents/settlement_building.html', {
        **_common(settlement),
        'items': [
            {'name': i.concept.name, 'detail': i.detail, 'owner_only': i.concept.kind == 'owner_only',
             'amount': format_money(i.amount)}
            for i in items
        ],
        'total': format_money(sum((i.amount for i in items), Decimal('0'))),
        'charges': [
            {**c, 'role': ROLE_LABEL[c['role']], 'coefficient': f"{c['coefficient'] * 100:.2f}".replace('.', ',') + ' %',
             'total': format_money(c['total'])}
            for c in charges
        ],
        'distributed': format_money(sum((c['total'] for c in charges), Decimal('0'))),
    })


def unit_html(settlement, occupancy):
    detail = portal_settlement_detail(occupancy, settlement.month)
    previous = previous_balance(settlement, occupancy)
    return render_to_string('documents/settlement_unit.html', {
        **_common(settlement),
        'person': str(occupancy.person),
        'unit': occupancy.unit,
        'role': ROLE_LABEL[occupancy.role],
        'coefficient': f"{detail['coefficient'] * 100:.2f}".replace('.', ',') + ' %',
        'lines': [
            {'concept': line['concept'], 'detail': line['detail'],
             'building_total': format_money(line['building_total']), 'amount': format_money(line['amount'])}
            for line in detail['lines']
        ],
        'total': format_money(detail['total']),
        'previous': format_money(previous),
        'to_pay': format_money(max(previous + detail['total'], Decimal('0'))),
        'concept': f'Apto {occupancy.unit.number}',
    })


def _store(settlement, occupancy, html):
    pdf = HTML(string=html).write_pdf()
    building = settlement.building
    key = f'settlements/{building.organization_id}/{building.pk}/{settlement.month:%Y-%m}/{uuid.uuid4()}.pdf'
    storage.put_bytes(key, pdf, 'application/pdf')
    try:
        with transaction.atomic():
            return SettlementDocument.objects.create(
                settlement=settlement,
                occupancy=occupancy,
                file_key=key,
                file_sha256=hashlib.sha256(pdf).hexdigest(),
                size_bytes=len(pdf),
            )
    except IntegrityError:
        # Otro pedido lo generó al mismo tiempo: vale el primero y este archivo sobra.
        storage.delete(key)
        return SettlementDocument.objects.get(settlement=settlement, occupancy=occupancy)


def settlement_document(settlement, occupancy=None):
    """El PDF del edificio (sin ocupación) o de una cuenta; lo genera si todavía no existe."""
    existing = SettlementDocument.objects.filter(settlement=settlement, occupancy=occupancy).first()
    if existing:
        return existing
    html = unit_html(settlement, occupancy) if occupancy else building_html(settlement)
    return _store(settlement, occupancy, html)


def signed_url(document, filename):
    return storage.signed_url(document.file_key, content_type='application/pdf', filename=filename)
