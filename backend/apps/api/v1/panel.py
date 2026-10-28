import calendar
from collections import defaultdict
from collections.abc import Mapping
from datetime import date
from decimal import Decimal

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.api.permissions import IsEmployee
from apps.api.scoping import (
    employee_buildings,
    employee_organizations,
    get_in_scope_or_404,
)
from apps.api.v1.scoping import (
    BuildingDetailSerializer,
    OccupancySerializer,
    UnitSerializer,
)
from apps.api.v1.scoping_views import OrganizationBuildingListView
from apps.buildings import services as building_services
from apps.buildings.models import Building, ExpenseConcept, Unit
from apps.communications import services as communication_services
from apps.communications.models import Claim, Task
from apps.core.money import to_money
from apps.documents import data as document_data
from apps.documents import exports
from apps.documents import pdf as settlement_pdf
from apps.ledger import payments as payment_services
from apps.ledger import services as ledger_services
from apps.ledger.accounts import portal_movements, portal_settlement_detail
from apps.ledger.models import LedgerEntry, Receipt
from apps.ledger.reports import portfolio_totals
from apps.people import services as people_services
from apps.people.models import Occupancy, Person
from apps.settlements import services as settlement_services
from apps.settlements.models import Settlement
from apps.settlements.services import settlement_total
from apps.storage import services as storage


MONEY = '{:.2f}'
COEFFICIENT = '{:.6f}'


def money(value):
    return MONEY.format(value or Decimal('0'))


def coefficient(value):
    return COEFFICIENT.format(value or Decimal('0'))


def _error_response(error):
    if isinstance(error, ValidationError):
        messages = error.messages
        body = {'detail': messages[0] if messages else 'La solicitud no es válida.'}
        if len(messages) > 1:
            body['errors'] = messages
        return Response(body, status=400)
    if isinstance(error, DjangoPermissionDenied):
        return Response({'detail': str(error)}, status=403)
    if isinstance(error, TypeError):
        return Response({'detail': 'Los montos se envían como texto.'}, status=400)
    raise error


class PanelAPIView(APIView):
    permission_classes = [IsEmployee]

    def handle_exception(self, exc):
        if isinstance(exc, (ValidationError, DjangoPermissionDenied, TypeError)):
            return _error_response(exc)
        return super().handle_exception(exc)


def _payload(request):
    if not isinstance(request.data, Mapping):
        raise ValidationError('El cuerpo de la solicitud debe ser un objeto JSON.')
    return {key: request.data[key] for key in request.data}


def _required(data, name):
    if name not in data or data[name] is None or data[name] == '':
        raise ValidationError(f'El campo "{name}" es obligatorio.')
    return data[name]


def _date(value, field='fecha'):
    if not isinstance(value, str):
        raise ValidationError(f'El campo "{field}" debe ser una fecha válida (AAAA-MM-DD).')
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValidationError(
            f'El campo "{field}" debe ser una fecha válida (AAAA-MM-DD).'
        ) from error


def _month(value):
    parsed = _date(f'{value}-01', 'month')
    if parsed.strftime('%Y-%m') != value:
        raise ValidationError('El mes debe tener formato AAAA-MM.')
    return parsed


def _money_input(value):
    if not isinstance(value, str):
        raise TypeError('Los montos se envían como texto.')
    return to_money(value)


def _person_json(person):
    return {
        'id': str(person.pk),
        'name': str(person),
        'first_name': person.first_name,
        'last_name': person.last_name,
        'email': person.email,
        'phone': person.phone,
        'document': person.document,
    }


def _building_json(building):
    return {
        **BuildingDetailSerializer(building).data,
        'neighborhood': building.neighborhood,
        'city': building.city,
        'due_day': building.due_day,
        'reserve_opening': money(building.reserve_opening),
    }


def _unit_json(unit):
    return {
        **UnitSerializer(unit).data,
        'receives_paper': unit.receives_paper,
    }


def _occupancy_json(occupancy):
    return {
        **OccupancySerializer(occupancy).data,
        'person': {
            'id': str(occupancy.person_id),
            'name': str(occupancy.person),
            'phone': occupancy.person.phone,
            'email': occupancy.person.email,
        },
    }


def _entry_json(entry):
    return {
        'id': str(entry.pk),
        'date': entry.date.isoformat(),
        'kind': entry.kind,
        'amount': money(entry.amount),
        'description': entry.description,
    }


def _task_json(task):
    return {
        'id': str(task.pk),
        'text': task.text,
        'building': task.building.name,
        'building_id': str(task.building_id),
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'done': task.done,
        'created_by': str(task.created_by),
    }


def _message_author_name(message, claim) -> str:
    """Nombre visible de quien escribió: el empleado (o la administración) o el residente."""
    if message.from_admin:
        full_name = f'{message.author.first_name} {message.author.last_name}'.strip()
        return full_name or claim.building.organization.name
    return str(claim.author)


def _claim_detail_json(claim):
    return {
        'id': str(claim.pk),
        'title': claim.title,
        'kind': claim.kind,
        'unit': claim.unit.number,
        'author': str(claim.author),
        'status': claim.status,
        'date': claim.created_at.date().isoformat(),
        'messages': [
            {
                'id': str(item.pk),
                'author': _message_author_name(item, claim),
                'from_admin': item.from_admin,
                'text': item.text,
                'date': item.created_at.isoformat(),
            }
            for item in claim.messages.select_related('author').all()
        ],
    }


def _receipt_json(receipt):
    allocations = [
        {
            'occupancy': str(item.occupancy.pk),
            'unit': item.occupancy.unit.number,
            'building': item.occupancy.unit.building.name,
            'role': item.occupancy.role,
            'amount': money(item.amount),
        }
        for item in receipt.allocations.all()
    ]
    first = receipt.allocations.first()
    return {
        'id': str(receipt.pk),
        'person': str(receipt.person),
        'building': first.occupancy.unit.building.name if first else None,
        'unit': first.occupancy.unit.number if first else None,
        'role': first.occupancy.role if first else None,
        'file': receipt.file_key,
        'content_type': receipt.content_type,
        'transfer_date': receipt.transfer_date.isoformat(),
        'declared_amount': money(receipt.declared_amount),
        'note': receipt.note,
        'allocations': allocations,
        'status': receipt.status,
        'reason': receipt.rejection_reason,
        'reviewed_by': str(receipt.reviewed_by) if receipt.reviewed_by else None,
        'reviewed_at': receipt.reviewed_at.isoformat() if receipt.reviewed_at else None,
    }


def _settlement_payload(settlement):
    return {
        'month': settlement.month.strftime('%Y-%m'),
        'status': settlement.status,
        'items': [
            {
                'concept': item.concept.name,
                'concept_id': str(item.concept_id),
                'amount': money(item.amount),
                'detail': item.detail,
            }
            for item in settlement.items.select_related('concept').all()
        ],
        'total': money(settlement_total(settlement)),
        'issued_by': str(settlement.issued_by) if settlement.issued_by else None,
        'issued_at': settlement.issued_at.isoformat() if settlement.issued_at else None,
    }


def month_param(request):
    value = request.query_params.get('month')
    if value:
        try:
            parsed = date.fromisoformat(f'{value}-01')
            if parsed.strftime('%Y-%m') == value:
                return parsed
        except ValueError:
            pass
    return timezone.localdate().replace(day=1)


def employee_building_or_404(user, building_id):
    return get_in_scope_or_404(
        employee_buildings(user).select_related('organization'), building_id
    )


def month_end(month):
    return month.replace(day=calendar.monthrange(month.year, month.month)[1])


def active_occupancies(building, month):
    """Cuentas del mes: toda ocupación que se superpone con él, como al emitir (un cambio de
    inquilino a mitad de mes muestra a los dos)."""
    return Occupancy.objects.filter(
        unit__building=building,
        start_date__lte=month_end(month),
    ).filter(Q(end_date__isnull=True) | Q(end_date__gte=month))


def occupancy_data(occupancies, month):
    occupancies = list(occupancies)
    ids = [item.pk for item in occupancies]
    entries = list(
        LedgerEntry.objects.filter(occupancy_id__in=ids)
        .select_related('settlement', 'concept')
        .order_by('occupancy_id', 'date', 'created_at', 'pk')
    )
    by_occupancy = defaultdict(list)
    for entry in entries:
        by_occupancy[entry.occupancy_id].append(entry)
    receipts = list(
        Receipt.objects.filter(
            status=Receipt.Status.PENDING, allocations__occupancy_id__in=ids
        )
        .select_related('person')
        .prefetch_related('allocations__occupancy__unit__building')
        .distinct()
    )
    receipts_by_occupancy = defaultdict(list)
    for receipt in receipts:
        for allocation in receipt.allocations.all():
            receipts_by_occupancy[allocation.occupancy_id].append((receipt, allocation))
    return occupancies, by_occupancy, receipts_by_occupancy


def account_row(occupancy, entries, receipts, month, settlement_issued=True):
    current_entries = [
        item
        for item in entries
        if item.kind == LedgerEntry.Kind.CHARGE
        and item.settlement_id
        and item.settlement.month == month
    ]
    current_charge = sum((item.amount for item in current_entries), Decimal('0'))
    balance = sum((item.amount for item in entries), Decimal('0'))
    account_periods = periods_from_entries(entries)
    overdue = [item for item in account_periods if item[0] < month and item[3] > 0]
    # Parte del cargo del mes ya cubierta: los pagos se imputan primero a lo más viejo.
    paid = next((item[2] for item in account_periods if item[0] == month), Decimal('0'))
    pending_review = bool(receipts)
    # Mismo orden que el portal (ledger.accounts.account_status): un moroso sigue siendo
    # moroso aunque el mes en curso todavía no tenga liquidación emitida.
    if pending_review:
        status = 'revision'
    elif overdue:
        status = 'moroso'
    elif not settlement_issued and current_charge == 0:
        status = 'sin-cargar'
    elif balance > 0:
        status = 'pendiente'
    else:
        status = 'pagado'
    return {
        'id': str(occupancy.pk),
        'unit': occupancy.unit.number,
        'coefficient': coefficient(occupancy.unit.coefficient),
        'person': {
            'name': str(occupancy.person),
            'phone': occupancy.person.phone,
            'email': occupancy.person.email,
        },
        'role': occupancy.role,
        'receives_paper': occupancy.unit.receives_paper,
        'charge': money(current_charge),
        'paid': money(paid),
        'balance': money(balance),
        'status': status,
        'overdue_months': [item[0].strftime('%Y-%m') for item in overdue],
        'overdue_amount': money(sum((item[3] for item in overdue), Decimal('0'))),
    }


def periods_from_entries(entries):
    charged = defaultdict(lambda: Decimal('0'))
    credits = Decimal('0')
    for entry in entries:
        if entry.kind == LedgerEntry.Kind.CHARGE and entry.amount > 0 and entry.settlement_id:
            charged[entry.settlement.month] += entry.amount
        elif (
            entry.kind in (LedgerEntry.Kind.OPENING, LedgerEntry.Kind.SURCHARGE)
            and entry.amount > 0
        ):
            charged[entry.date.replace(day=1)] += entry.amount
        elif (
            entry.kind == LedgerEntry.Kind.ADJUSTMENT
            and entry.amount > 0
            and entry.adjusts_id
        ):
            target = next((item for item in entries if item.pk == entry.adjusts_id), None)
            if target:
                charged[
                    (
                        target.settlement.month
                        if target.settlement_id
                        else target.date.replace(day=1)
                    )
                ] += entry.amount
        elif entry.amount < 0:
            credits -= entry.amount
    result = []
    for item in sorted(charged):
        covered = min(charged[item], credits)
        credits -= covered
        result.append((item, charged[item], covered, charged[item] - covered))
    return result


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortfolioView(PanelAPIView):
    def get(self, request, organization_id):
        organization = get_in_scope_or_404(
            employee_organizations(request.user), organization_id
        )
        month = month_param(request)
        totals = portfolio_totals(organization, month)
        buildings = list(
            organization.buildings.all().prefetch_related('units', 'settlements')
        )
        occupancies, by_occ, receipts_by_occ = occupancy_data(
            Occupancy.objects.filter(
                unit__building__organization=organization,
                start_date__lte=month_end(month),
            )
            .filter(Q(end_date__isnull=True) | Q(end_date__gte=month))
            .select_related('unit', 'person'),
            month,
        )
        occupancies_by_building = defaultdict(list)
        for occupancy in occupancies:
            occupancies_by_building[occupancy.unit.building_id].append(occupancy)
        building_rows = []
        for building in buildings:
            settlement = next(
                (item for item in building.settlements.all() if item.month == month),
                None,
            )
            rows = [
                account_row(
                    item,
                    by_occ[item.pk],
                    receipts_by_occ[item.pk],
                    month,
                    bool(settlement and settlement.status == 'issued'),
                )
                for item in occupancies_by_building[building.pk]
            ]
            counts = {
                key: sum(row['status'] == key for row in rows)
                for key in ('pagado', 'revision', 'pendiente', 'moroso', 'sin-cargar')
            }
            expected = sum((Decimal(row['charge']) for row in rows), Decimal('0'))
            collected = sum(
                (
                    min(
                        Decimal(row['charge']),
                        max(Decimal('0'), Decimal(row['charge']) - Decimal(row['balance'])),
                    )
                    for row in rows
                ),
                Decimal('0'),
            )
            building_rows.append(
                {
                    'id': str(building.pk),
                    'name': building.name,
                    'address': building.address,
                    'neighborhood': building.neighborhood,
                    'due_day': building.due_day,
                    'units': len(building.units.all()),
                    'counts': counts,
                    'expected': money(expected),
                    'collected': money(collected),
                    'in_review': money(
                        sum(
                            (
                                Decimal(row['balance'])
                                for row in rows
                                if row['status'] == 'revision'
                            ),
                            Decimal('0'),
                        )
                    ),
                    # Igual que portfolio_totals: solo lo vencido (meses anteriores al actual).
                    'debt': money(
                        sum((Decimal(row['overdue_amount']) for row in rows), Decimal('0'))
                    ),
                    'settlement': settlement.status if settlement else None,
                    'severe': any(len(row['overdue_months']) >= 2 for row in rows),
                }
            )
        queue = []
        seen_allocations = set()
        for allocations in receipts_by_occ.values():
            for receipt, allocation in allocations:
                if allocation.pk in seen_allocations:
                    continue
                seen_allocations.add(allocation.pk)
                occupancy = allocation.occupancy
                queue.append(
                    {
                        'id': str(receipt.pk),
                        'person': str(receipt.person),
                        'building': occupancy.unit.building.name,
                        'unit': occupancy.unit.number,
                        'role': occupancy.role,
                        'file': receipt.file_key,
                        'date': receipt.transfer_date.isoformat(),
                        'amount': money(allocation.amount),
                    }
                )
        return Response(
            {
                'month': month.strftime('%Y-%m'),
                'portfolio_totals': {
                    'accounts': totals.accounts,
                    'expected': money(totals.expected),
                    'collected': money(totals.collected),
                    'in_review': money(totals.in_review),
                    'debt': money(totals.debt),
                    'delinquent': totals.delinquent,
                    'open_claims': totals.open_claims,
                },
                'buildings': building_rows,
                'receipt_queue': queue,
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class CollectionHistoryView(PanelAPIView):
    """Cobrado sobre lo emitido en los últimos meses, con la imputación FIFO de cada cuenta."""

    MONTHS = 6

    def get(self, request, organization_id):
        organization = get_in_scope_or_404(
            employee_organizations(request.user), organization_id
        )
        month = month_param(request)
        months = sorted(
            set(
                Settlement.objects.filter(
                    building__organization=organization,
                    status=Settlement.Status.ISSUED,
                    month__lte=month,
                ).values_list('month', flat=True)
            )
        )[-self.MONTHS:]
        entries = (
            LedgerEntry.objects.filter(
                occupancy__unit__building__organization=organization
            )
            .select_related('settlement')
            .order_by('occupancy_id', 'date', 'created_at', 'pk')
        )
        by_occupancy = defaultdict(list)
        for entry in entries:
            by_occupancy[entry.occupancy_id].append(entry)
        charged = defaultdict(lambda: Decimal('0'))
        collected = defaultdict(lambda: Decimal('0'))
        for account_entries in by_occupancy.values():
            for period, amount, covered, _ in periods_from_entries(account_entries):
                charged[period] += amount
                collected[period] += covered
        return Response(
            {
                'months': [
                    {
                        'month': item.strftime('%Y-%m'),
                        'charged': money(charged[item]),
                        'collected': money(collected[item]),
                    }
                    for item in months
                ]
            }
        )


def building_account_rows(building, month):
    occupancies, by_occ, receipts = occupancy_data(
        active_occupancies(building, month).select_related('unit', 'person'), month
    )
    settlement_issued = building.settlements.filter(month=month, status='issued').exists()
    return [
        account_row(item, by_occ[item.pk], receipts[item.pk], month, settlement_issued)
        for item in occupancies
    ]


@extend_schema(responses=OpenApiTypes.OBJECT)
class BuildingAccountsView(PanelAPIView):
    def get(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        month = month_param(request)
        rows = building_account_rows(building, month)
        status = request.query_params.get('status')
        query = request.query_params.get('q', '').strip().lower()
        if status:
            rows = [row for row in rows if row['status'] == status]
        if query:
            rows = [
                row
                for row in rows
                if query in row['unit'].lower() or query in row['person']['name'].lower()
            ]
        return Response(
            {
                'month': month.strftime('%Y-%m'),
                'building': str(building.pk),
                'accounts': rows,
            }
        )


@extend_schema(responses={(200, exports.XLSX): OpenApiTypes.BINARY})
class BuildingAccountsExportView(PanelAPIView):
    """Cobros del edificio en Excel (D5)."""

    def get(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        month = month_param(request)
        rows = sorted(
            building_account_rows(building, month),
            key=lambda row: (int(row['unit']) if row['unit'].isdigit() else 10**9, row['unit'], row['role'] != 'owner'),
        )
        floors = dict(building.units.values_list('number', 'floor'))
        return exports.accounts_workbook(building, month, rows, floors)


@extend_schema(responses={(200, exports.XLSX): OpenApiTypes.BINARY})
class OccupancyMovementsExportView(PanelAPIView):
    """Cuenta corriente de una ocupación en Excel (D5)."""

    def get(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(unit__building__in=employee_buildings(request.user))
            .select_related('unit__building', 'person'),
            occupancy_id,
        )
        return exports.movements_workbook(occupancy, portal_movements(occupancy))


def issued_settlement_or_404(building, month):
    return get_object_or_404(
        Settlement.objects.filter(building=building, status=Settlement.Status.ISSUED)
        .select_related('building__organization', 'issued_by'),
        month=_month(month),
    )


@extend_schema(responses={(200, exports.XLSX): OpenApiTypes.BINARY})
class SettlementExportView(PanelAPIView):
    """Liquidación emitida del mes en Excel: conceptos y prorrateo por unidad (D5)."""

    def get(self, request, building_id, month):
        building = employee_building_or_404(request.user, building_id)
        settlement = issued_settlement_or_404(building, month)
        return exports.settlement_workbook(
            settlement,
            document_data.settlement_items(settlement),
            document_data.settlement_charges(settlement),
        )


def pdf_url_response(settlement, occupancy=None):
    """URL firmada de 5 minutos al PDF (D4); lo genera la primera vez."""
    if occupancy is not None and portal_settlement_detail(occupancy, settlement.month) is None:
        raise Http404
    document = settlement_pdf.settlement_document(settlement, occupancy)
    building = settlement.building
    name = f'liquidacion-{exports.file_slug(building.name)}-{settlement.month:%Y-%m}'
    if occupancy is not None:
        name += f'-apto-{occupancy.unit.number}'
    return Response({'url': settlement_pdf.signed_url(document, name + '.pdf')})


@extend_schema(responses=OpenApiTypes.OBJECT)
class BuildingSettlementPdfView(PanelAPIView):
    def get(self, request, building_id, month):
        building = employee_building_or_404(request.user, building_id)
        return pdf_url_response(issued_settlement_or_404(building, month))


@extend_schema(responses=OpenApiTypes.OBJECT)
class OccupancySettlementPdfView(PanelAPIView):
    """PDF de una cuenta, para imprimir el de quienes reciben la liquidación en papel."""

    def get(self, request, occupancy_id, month):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(unit__building__in=employee_buildings(request.user))
            .select_related('unit__building__organization', 'person'),
            occupancy_id,
        )
        settlement = issued_settlement_or_404(occupancy.unit.building, month)
        return pdf_url_response(settlement, occupancy)


@extend_schema(responses=OpenApiTypes.OBJECT)
class BuildingSummaryView(PanelAPIView):
    def get(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        month = month_param(request)
        settlements = list(building.settlements.prefetch_related('items__concept').all())
        settlement = next((item for item in settlements if item.month == month), None)
        occupancies, by_occ, receipts = occupancy_data(
            active_occupancies(building, month).select_related('unit', 'person'), month
        )
        rows = [
            account_row(
                item,
                by_occ[item.pk],
                receipts[item.pk],
                month,
                bool(settlement and settlement.status == 'issued'),
            )
            for item in occupancies
        ]
        items = (
            []
            if settlement is None
            else [
                {
                    'concept': item.concept.name,
                    'type': item.concept.kind,
                    'amount': money(item.amount),
                    'detail': item.detail,
                }
                for item in settlement.items.all()
            ]
        )
        reserve = building.reserve_opening + sum(
            (
                item.amount
                for settlement_item in settlements
                for item in settlement_item.items.all()
                if item.concept.is_reserve_fund
            ),
            Decimal('0'),
        )
        delinquent = [
            {
                'unit': row['unit'],
                'person': row['person']['name'],
                'role': row['role'],
                'months': row['overdue_months'],
                'debt': row['balance'],
            }
            for row in rows
            if row['status'] == 'moroso'
        ]
        return Response(
            {
                'month': month.strftime('%Y-%m'),
                'items': items,
                'funds': {
                    'reserve': money(reserve),
                    'collected': money(
                        sum(
                            (
                                max(
                                    Decimal('0'),
                                    Decimal(row['charge']) - Decimal(row['balance']),
                                )
                                for row in rows
                            ),
                            Decimal('0'),
                        )
                    ),
                    'receivable': money(
                        sum(
                            (max(Decimal('0'), Decimal(row['balance'])) for row in rows),
                            Decimal('0'),
                        )
                    ),
                    'coefficient_sum': coefficient(
                        sum(
                            (
                                item.unit.coefficient
                                for item in occupancies
                                if item.role == 'owner'
                            ),
                            Decimal('0'),
                        )
                    ),
                },
                'delinquent': delinquent,
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class BuildingSettlementsView(PanelAPIView):
    def get(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        settlements = (
            building.settlements.select_related('issued_by')
            .prefetch_related('items__concept')
            .all()
        )
        concepts = building.concepts.filter(is_active=True).order_by('order', 'name')
        return Response(
            {
                'concepts': [
                    {
                        'id': str(concept.pk),
                        'name': concept.name,
                        'kind': concept.kind,
                        'is_reserve_fund': concept.is_reserve_fund,
                    }
                    for concept in concepts
                ],
                'settlements': [
                    {
                        'month': settlement.month.strftime('%Y-%m'),
                        'status': settlement.status,
                        'items': [
                            {
                                'concept': item.concept.name,
                                'concept_id': str(item.concept_id),
                                'amount': money(item.amount),
                                'detail': item.detail,
                            }
                            for item in settlement.items.all()
                        ],
                        'total': money(
                            sum((item.amount for item in settlement.items.all()), Decimal('0'))
                        ),
                        'issued_by': str(settlement.issued_by)
                        if settlement.issued_by
                        else None,
                        'issued_at': settlement.issued_at.isoformat()
                        if settlement.issued_at
                        else None,
                    }
                    for settlement in settlements
                ]
            }
        )


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class OccupancyDetailView(PanelAPIView):
    def get(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(unit__building__in=employee_buildings(request.user))
            .select_related('unit__building', 'person'),
            occupancy_id,
        )
        month = month_param(request)
        all_occ = list(
            occupancy.unit.occupancies.filter(end_date__isnull=True).select_related('person')
        )
        _, by_occ, receipts = occupancy_data([occupancy], month)
        entries = by_occ[occupancy.pk]
        settlement_issued = occupancy.unit.building.settlements.filter(
            month=month, status='issued'
        ).exists()
        row = account_row(occupancy, entries, receipts[occupancy.pk], month, settlement_issued)
        settlement = (
            occupancy.unit.building.settlements.filter(month=month)
            .prefetch_related('items__concept')
            .first()
        )
        # Total del concepto en el edificio (como en el portal); base_amount es la parte
        # de la unidad antes de redondear.
        building_totals = (
            {item.concept_id: item.amount for item in settlement.items.all()}
            if settlement
            else {}
        )
        lines = [
            {
                'concept': entry.concept.name,
                'total': money(building_totals.get(entry.concept_id, entry.base_amount)),
                'coefficient': coefficient(entry.coefficient),
                'days': entry.days,
                'days_in_month': entry.days_in_month,
                'amount': money(entry.amount),
            }
            for entry in entries
            if entry.kind == LedgerEntry.Kind.CHARGE
            and entry.settlement_id == getattr(settlement, 'pk', None)
        ]
        balance = Decimal('0')
        movements = []
        for entry in entries:
            balance += entry.amount
            movements.append(
                {
                    'id': str(entry.pk),
                    'kind': entry.kind,
                    'date': entry.date.isoformat(),
                    'concept': entry.description
                    or (
                        entry.concept.name
                        if entry.concept
                        else entry.get_kind_display()
                    ),
                    'debit': money(entry.amount if entry.amount > 0 else 0),
                    'credit': money(-entry.amount if entry.amount < 0 else 0),
                    'balance': money(balance),
                }
            )
        pending = None
        if receipts[occupancy.pk]:
            receipt, allocation = receipts[occupancy.pk][0]
            pending = {
                'id': str(receipt.pk),
                'file': receipt.file_key,
                'date': receipt.transfer_date.isoformat(),
                'amount': money(allocation.amount),
            }
        return Response(
            {
                'id': str(occupancy.pk),
                'unit': occupancy.unit.number,
                'unit_id': str(occupancy.unit_id),
                'floor': occupancy.unit.floor,
                'building': occupancy.unit.building.name,
                'coefficient': coefficient(occupancy.unit.coefficient),
                'role': occupancy.role,
                'status': row['status'],
                'person': row['person'],
                'other_occupancies': [
                    {'id': str(item.pk), 'role': item.role, 'person': str(item.person)}
                    for item in all_occ
                    if item.pk != occupancy.pk
                ],
                'balance': row['balance'],
                'overdue_months': row['overdue_months'],
                'pending_receipt': pending,
                'lines': lines,
                'movements': list(reversed(movements[-6:])),
            }
        )

    def patch(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(unit__building__in=employee_buildings(request.user))
            .select_related('unit__building__organization', 'person'),
            occupancy_id,
        )
        data = _payload(request)
        kwargs = {}
        allowed = {'person_id', 'person', 'start_date', 'end_date'}
        if set(data) - allowed:
            raise ValidationError('Solo se pueden corregir persona y fechas de la ocupación.')
        if 'person_id' in data or 'person' in data:
            person_id = data.get('person_id', data.get('person'))
            kwargs['person'] = get_in_scope_or_404(
                Person.objects.filter(organization=occupancy.unit.building.organization),
                person_id,
            )
        if 'start_date' in data and data['start_date'] is not None:
            kwargs['start_date'] = _date(data['start_date'], 'start_date')
        if 'end_date' in data:
            kwargs['end_date'] = (
                _date(data['end_date'], 'end_date')
                if data['end_date'] is not None
                else None
            )
        updated = people_services.correct_occupancy(occupancy, request.user, **kwargs)
        return Response(_occupancy_json(updated))


@extend_schema(responses=OpenApiTypes.OBJECT)
class ReceiptDetailView(PanelAPIView):
    def get(self, request, receipt_id):
        receipt = get_in_scope_or_404(
            Receipt.objects.filter(
                person__organization__in=employee_organizations(request.user)
            )
            .select_related('person', 'reviewed_by')
            .prefetch_related('allocations__occupancy__unit__building'),
            receipt_id,
        )
        return Response(_receipt_json(receipt))


@extend_schema(responses=OpenApiTypes.OBJECT)
class ReceiptFileView(PanelAPIView):
    """URL firmada de 5 minutos para ver el archivo del comprobante (D1b)."""

    def get(self, request, receipt_id):
        receipt = get_in_scope_or_404(
            Receipt.objects.filter(
                person__organization__in=employee_organizations(request.user)
            ),
            receipt_id,
        )
        if not storage.exists(receipt.file_key):
            raise Http404
        return Response({
            'url': storage.signed_url(receipt.file_key, content_type=receipt.content_type),
            'content_type': receipt.content_type,
        })


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class BuildingNoticesView(PanelAPIView):
    def get(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        return Response(
            {
                'notices': [
                    {
                        'id': str(item.pk),
                        'title': item.title,
                        'body': item.body,
                        'date': item.created_at.date().isoformat(),
                        'published_by': str(item.published_by),
                    }
                    for item in building.notices.select_related('published_by').all()
                ]
            }
        )

    def post(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        data = _payload(request)
        notice = communication_services.publish_notice(
            building,
            request.user,
            str(_required(data, 'title')),
            str(_required(data, 'body')),
        )
        return Response(
            {
                'id': str(notice.pk),
                'title': notice.title,
                'body': notice.body,
                'date': notice.created_at.date().isoformat(),
                'published_by': str(notice.published_by),
            },
            status=201,
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class BuildingClaimsView(PanelAPIView):
    def get(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        return Response(
            {
                'claims': [
                    {
                        'id': str(item.pk),
                        'title': item.title,
                        'kind': item.kind,
                        'unit': item.unit.number,
                        'author': str(item.author),
                        'status': item.status,
                        'date': item.created_at.date().isoformat(),
                        'message_count': item.messages.count(),
                    }
                    for item in building.claims.select_related('unit', 'author')
                    .prefetch_related('messages')
                    .all()
                ]
            }
        )


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ClaimDetailView(PanelAPIView):
    def get(self, request, claim_id):
        claim = get_in_scope_or_404(
            Claim.objects.filter(building__in=employee_buildings(request.user))
            .select_related('building__organization', 'unit', 'author')
            .prefetch_related('messages__author'),
            claim_id,
        )
        return Response(_claim_detail_json(claim))

    def patch(self, request, claim_id):
        claim = get_in_scope_or_404(
            Claim.objects.filter(building__in=employee_buildings(request.user))
            .select_related('building__organization', 'unit', 'author')
            .prefetch_related('messages__author'),
            claim_id,
        )
        data = _payload(request)
        updated = communication_services.set_claim_status(
            claim, request.user, _required(data, 'status')
        )
        return Response(_claim_detail_json(updated))


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ClaimReplyView(PanelAPIView):
    def post(self, request, claim_id):
        claim = get_in_scope_or_404(
            Claim.objects.filter(building__in=employee_buildings(request.user)).select_related(
                'building__organization', 'unit', 'author'
            ),
            claim_id,
        )
        data = _payload(request)
        message = communication_services.reply_as_admin(
            claim, request.user, str(_required(data, 'text'))
        )
        return Response(
            {
                'id': str(message.pk),
                'author': _message_author_name(message, claim),
                'from_admin': message.from_admin,
                'text': message.text,
                'date': message.created_at.isoformat(),
            },
            status=201,
        )


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class OrganizationTasksView(PanelAPIView):
    def get(self, request, organization_id):
        organization = get_in_scope_or_404(
            employee_organizations(request.user), organization_id
        )
        queryset = organization.tasks.select_related('building', 'created_by')
        building = request.query_params.get('building')
        if building:
            queryset = queryset.filter(building_id=building)
        return Response({'tasks': [_task_json(item) for item in queryset.all()]})

    def post(self, request, organization_id):
        organization = get_in_scope_or_404(
            employee_organizations(request.user), organization_id
        )
        data = _payload(request)
        building_id = data.get('building_id', data.get('building'))
        if not building_id:
            raise ValidationError('El campo "building_id" es obligatorio.')
        building = get_in_scope_or_404(
            Building.objects.filter(organization=organization), building_id
        )
        due_date = data.get('due_date')
        task = communication_services.create_task(
            organization,
            building,
            request.user,
            str(_required(data, 'text')),
            _date(due_date, 'due_date') if due_date else None,
        )
        return Response(_task_json(task), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ToggleTaskView(PanelAPIView):
    def post(self, request, task_id):
        task = get_in_scope_or_404(
            Task.objects.filter(
                organization__in=employee_organizations(request.user)
            ).select_related('building', 'created_by', 'organization'),
            task_id,
        )
        updated = communication_services.toggle_task(task, request.user)
        updated.building = task.building
        updated.created_by = task.created_by
        return Response(_task_json(updated))


class OrganizationBuildingsView(OrganizationBuildingListView):
    def handle_exception(self, exc):
        if isinstance(exc, (ValidationError, DjangoPermissionDenied, TypeError)):
            return _error_response(exc)
        return super().handle_exception(exc)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, organization_id):
        organization = get_in_scope_or_404(
            employee_organizations(request.user), organization_id
        )
        data = _payload(request)
        name = str(_required(data, 'name')).strip()
        address = str(_required(data, 'address')).strip()
        if not name or not address:
            raise ValidationError('El nombre y la dirección son obligatorios.')
        fields = {'name': name, 'address': address}
        for key in ('neighborhood', 'city', 'bank_name', 'bank_account', 'bank_holder'):
            if key in data and data[key] is not None:
                fields[key] = str(data[key])
        if 'due_day' in data and data['due_day'] is not None:
            due_day = data['due_day']
            if isinstance(due_day, bool) or not isinstance(due_day, int) or not 1 <= due_day <= 28:
                raise ValidationError('El día de vencimiento debe estar entre 1 y 28.')
            fields['due_day'] = due_day
        if 'reserve_opening' in data and data['reserve_opening'] is not None:
            fields['reserve_opening'] = _money_input(data['reserve_opening'])
        if 'opening_date' in data and data['opening_date']:
            fields['opening_date'] = _date(data['opening_date'], 'opening_date')
        building = building_services.create_building(
            organization, request.user, **fields
        )
        return Response(_building_json(building), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class BuildingUnitsView(PanelAPIView):
    def post(self, request, building_id):
        building = employee_building_or_404(request.user, building_id)
        data = _payload(request)
        coefficient_raw = _required(data, 'coefficient')
        if not isinstance(coefficient_raw, str):
            raise TypeError('Los montos se envían como texto.')
        floor = _required(data, 'floor')
        if isinstance(floor, bool) or not isinstance(floor, int):
            raise ValidationError('El piso debe ser un número entero.')
        unit = building_services.add_unit(
            building,
            request.user,
            number=str(_required(data, 'number')).strip(),
            floor=floor,
            coefficient=coefficient_raw,
            receives_paper=bool(data.get('receives_paper', False)),
        )
        return Response(_unit_json(unit), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class OrganizationPeopleView(PanelAPIView):
    def post(self, request, organization_id):
        organization = get_in_scope_or_404(
            employee_organizations(request.user), organization_id
        )
        data = _payload(request)
        first_name = str(_required(data, 'first_name')).strip()
        last_name = str(_required(data, 'last_name')).strip()
        if not first_name or not last_name:
            raise ValidationError('Nombre y apellido son obligatorios.')
        try:
            person = people_services.create_person(
                organization,
                request.user,
                first_name=first_name,
                last_name=last_name,
                email=str(data.get('email', '') or ''),
                phone=str(data.get('phone', '') or ''),
                document=str(data.get('document', '') or ''),
            )
        except IntegrityError as error:
            if 'person_email_unique_per_org' in str(error).lower():
                raise ValidationError(
                    'Ya existe una persona con ese email en la organización.'
                ) from error
            raise
        return Response(_person_json(person), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class PersonDetailView(PanelAPIView):
    def patch(self, request, person_id):
        person = get_in_scope_or_404(
            Person.objects.filter(organization__in=employee_organizations(request.user)),
            person_id,
        )
        data = _payload(request)
        updated = people_services.update_person(person, request.user, **data)
        return Response(_person_json(updated))


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class MoveInView(PanelAPIView):
    def post(self, request, unit_id):
        unit = get_in_scope_or_404(
            Unit.objects.filter(building__in=employee_buildings(request.user)).select_related(
                'building__organization'
            ),
            unit_id,
        )
        data = _payload(request)
        person_id = data.get('person_id', data.get('person'))
        if not person_id:
            raise ValidationError('El campo "person_id" es obligatorio.')
        person = get_in_scope_or_404(
            Person.objects.filter(organization=unit.building.organization),
            person_id,
        )
        occupancy = people_services.move_in(
            unit,
            person,
            _required(data, 'role'),
            _date(_required(data, 'start_date'), 'start_date'),
            request.user,
        )
        return Response(_occupancy_json(occupancy), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class MoveOutView(PanelAPIView):
    def post(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(
                unit__building__in=employee_buildings(request.user)
            ).select_related('unit__building__organization', 'person'),
            occupancy_id,
        )
        data = _payload(request)
        updated = people_services.move_out(
            occupancy,
            _date(_required(data, 'end_date'), 'end_date'),
            request.user,
        )
        return Response(_occupancy_json(updated))


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ReplaceTenantView(PanelAPIView):
    def post(self, request, unit_id):
        unit = get_in_scope_or_404(
            Unit.objects.filter(building__in=employee_buildings(request.user)).select_related(
                'building__organization'
            ),
            unit_id,
        )
        data = _payload(request)
        person_id = data.get('person_id', data.get('new_person_id', data.get('person')))
        if not person_id:
            raise ValidationError('El campo "person_id" es obligatorio.')
        person = get_in_scope_or_404(
            Person.objects.filter(organization=unit.building.organization),
            person_id,
        )
        change_date = data.get('change_date', data.get('start_date'))
        if not change_date:
            raise ValidationError('El campo "change_date" es obligatorio.')
        occupancy = people_services.replace_tenant(
            unit,
            person,
            _date(change_date, 'change_date'),
            request.user,
        )
        return Response(_occupancy_json(occupancy), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class SellUnitView(PanelAPIView):
    def post(self, request, unit_id):
        unit = get_in_scope_or_404(
            Unit.objects.filter(building__in=employee_buildings(request.user)).select_related(
                'building__organization'
            ),
            unit_id,
        )
        data = _payload(request)
        buyer_id = data.get('buyer_id', data.get('person_id', data.get('buyer')))
        if not buyer_id:
            raise ValidationError('El campo "buyer_id" es obligatorio.')
        buyer = get_in_scope_or_404(
            Person.objects.filter(organization=unit.building.organization),
            buyer_id,
        )
        sale_date = data.get('sale_date', data.get('start_date'))
        if not sale_date:
            raise ValidationError('El campo "sale_date" es obligatorio.')
        occupancy = people_services.sell_unit(
            unit,
            buyer,
            _date(sale_date, 'sale_date'),
            request.user,
        )
        return Response(_occupancy_json(occupancy), status=201)


class SettlementDraftView(PanelAPIView):
    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def put(self, request, building_id, month):
        building = employee_building_or_404(request.user, building_id)
        parsed_month = _month(month)
        data = _payload(request)
        raw_items = data.get('items', {
            k: v for k, v in data.items() if k not in ('detail', 'details')
        })
        items = {}
        details = {}
        if isinstance(raw_items, Mapping):
            for concept_id, value in raw_items.items():
                concept = get_in_scope_or_404(
                    ExpenseConcept.objects.filter(building=building), concept_id
                )
                if isinstance(value, Mapping):
                    items[concept] = _money_input(_required(value, 'amount'))
                    if 'detail' in value and value['detail'] is not None:
                        details[concept] = str(value['detail'])
                else:
                    items[concept] = _money_input(value)
        elif isinstance(raw_items, list):
            for entry in raw_items:
                if not isinstance(entry, Mapping):
                    raise ValidationError('Cada ítem debe ser un objeto.')
                concept = get_in_scope_or_404(
                    ExpenseConcept.objects.filter(building=building),
                    _required(entry, 'concept_id'),
                )
                items[concept] = _money_input(_required(entry, 'amount'))
                if 'detail' in entry and entry['detail'] is not None:
                    details[concept] = str(entry['detail'])
        else:
            raise ValidationError('Los ítems de la liquidación no son válidos.')

        raw_details = data.get('details', data.get('detail'))
        if isinstance(raw_details, Mapping):
            for concept_id, detail in raw_details.items():
                concept = get_in_scope_or_404(
                    ExpenseConcept.objects.filter(building=building), concept_id
                )
                details[concept] = str(detail or '')

        settlement = settlement_services.save_draft(
            building,
            request.user,
            parsed_month,
            items,
            details=details,
        )
        return Response(_settlement_payload(settlement))

    @extend_schema(responses={204: None})
    def delete(self, request, building_id, month):
        building = employee_building_or_404(request.user, building_id)
        parsed_month = _month(month)
        settlement = get_object_or_404(
            Settlement.objects.filter(building=building), month=parsed_month
        )
        settlement_services.delete_draft(settlement, request.user)
        return Response(status=204)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class IssueSettlementView(PanelAPIView):
    def post(self, request, building_id, month):
        building = employee_building_or_404(request.user, building_id)
        parsed_month = _month(month)
        settlement = get_object_or_404(
            Settlement.objects.filter(building=building), month=parsed_month
        )
        summary = settlement_services.issue_settlement(settlement, request.user)
        settlement.refresh_from_db()
        return Response(
            {
                'month': settlement.month.strftime('%Y-%m'),
                'status': settlement.status,
                'charges_count': summary.charges_count,
                'total_distributed': money(summary.total_distributed),
                'rounding_differences': {
                    key: money(value)
                    for key, value in summary.rounding_differences.items()
                },
            }
        )


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ApproveReceiptView(PanelAPIView):
    def post(self, request, receipt_id):
        receipt = get_in_scope_or_404(
            Receipt.objects.filter(
                person__organization__in=employee_organizations(request.user)
            ),
            receipt_id,
        )
        data = _payload(request) if request.data else {}
        allocations = None
        if 'allocations' in data and data['allocations'] is not None:
            raw_allocations = data['allocations']
            allocations = {}
            if isinstance(raw_allocations, Mapping):
                for occ_id, amount in raw_allocations.items():
                    occupancy = get_in_scope_or_404(
                        Occupancy.objects.filter(
                            unit__building__in=employee_buildings(request.user)
                        ).select_related('unit__building__organization'),
                        occ_id,
                    )
                    allocations[occupancy] = _money_input(amount)
            elif isinstance(raw_allocations, list):
                for item in raw_allocations:
                    if not isinstance(item, Mapping):
                        raise ValidationError('Cada imputación debe ser un objeto.')
                    occ_id = item.get('occupancy_id', item.get('occupancy'))
                    if not occ_id:
                        raise ValidationError('El campo "occupancy_id" es obligatorio.')
                    occupancy = get_in_scope_or_404(
                        Occupancy.objects.filter(
                            unit__building__in=employee_buildings(request.user)
                        ).select_related('unit__building__organization'),
                        occ_id,
                    )
                    allocations[occupancy] = _money_input(_required(item, 'amount'))
            else:
                raise ValidationError('El formato de las imputaciones no es válido.')

        entries = payment_services.approve_receipt(receipt, request.user, allocations)
        updated = (
            Receipt.objects.select_related('person', 'reviewed_by')
            .prefetch_related('allocations__occupancy__unit__building')
            .get(pk=receipt.pk)
        )
        payload = _receipt_json(updated)
        payload['payments'] = [_entry_json(entry) for entry in entries]
        return Response(payload)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class RejectReceiptView(PanelAPIView):
    def post(self, request, receipt_id):
        receipt = get_in_scope_or_404(
            Receipt.objects.filter(
                person__organization__in=employee_organizations(request.user)
            ),
            receipt_id,
        )
        data = _payload(request)
        updated = payment_services.reject_receipt(
            receipt, request.user, str(_required(data, 'reason'))
        )
        updated = (
            Receipt.objects.select_related('person', 'reviewed_by')
            .prefetch_related('allocations__occupancy__unit__building')
            .get(pk=updated.pk)
        )
        return Response(_receipt_json(updated))


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class ManualPaymentView(PanelAPIView):
    def post(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(
                unit__building__in=employee_buildings(request.user)
            ).select_related('unit__building__organization'),
            occupancy_id,
        )
        data = _payload(request)
        entry = payment_services.record_manual_payment(
            occupancy,
            _money_input(_required(data, 'amount')),
            _date(_required(data, 'date'), 'date'),
            request.user,
            str(_required(data, 'source')),
        )
        return Response(_entry_json(entry), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class AdjustmentView(PanelAPIView):
    def post(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(
                unit__building__in=employee_buildings(request.user)
            ).select_related('unit__building__organization'),
            occupancy_id,
        )
        data = _payload(request)
        entry_id = _required(data, 'entry_id')
        entry = get_in_scope_or_404(
            LedgerEntry.objects.filter(occupancy=occupancy).select_related(
                'occupancy__unit__building__organization'
            ),
            entry_id,
        )
        adjustment = ledger_services.adjust(
            entry,
            _money_input(_required(data, 'amount')),
            str(_required(data, 'description')),
            request.user,
        )
        return Response(_entry_json(adjustment), status=201)


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class OpeningView(PanelAPIView):
    def post(self, request, occupancy_id):
        occupancy = get_in_scope_or_404(
            Occupancy.objects.filter(
                unit__building__in=employee_buildings(request.user)
            ).select_related('unit__building__organization'),
            occupancy_id,
        )
        data = _payload(request)
        amount = _money_input(_required(data, 'amount'))
        if amount == 0:
            raise ValidationError('El saldo de apertura no puede ser cero.')
        on_date = _date(_required(data, 'date'), 'date')
        try:
            entry = ledger_services.record_opening(
                occupancy, amount, on_date, request.user
            )
        except IntegrityError as error:
            if 'ledger_one_opening_per_occupancy' in str(error).lower():
                raise ValidationError(
                    'La ocupación ya tiene un asiento de apertura.'
                ) from error
            raise
        return Response(_entry_json(entry), status=201)
