from collections.abc import Mapping
from datetime import date

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied, ValidationError
from django.db.models import Q
from django.http import Http404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.api.permissions import IsResident
from apps.api.scoping import get_in_scope_or_404, resident_occupancies
from apps.api.v1.panel import (
    _error_response,
    _payload,
    _required,
    coefficient,
    money,
    month_param,
)
from apps.communications import services as communication_services
from apps.communications.models import Claim, Notice
from apps.ledger.accounts import (
    portal_account_summary,
    portal_months,
    portal_movements,
    portal_settlement_detail,
)
from apps.ledger.models import Receipt, ReceiptAllocation


KIND_ALIASES = {
    'reporte': Claim.Kind.REPORT,
    'reclamo': Claim.Kind.COMPLAINT,
}


class PortalAPIView(APIView):
    permission_classes = [IsResident]

    def handle_exception(self, exc):
        if isinstance(exc, (ValidationError, DjangoPermissionDenied, TypeError)):
            return _error_response(exc)
        return super().handle_exception(exc)


def resident_occupancy_or_404(user, occupancy_id):
    return get_in_scope_or_404(
        resident_occupancies(user).select_related(
            'unit__building__organization',
            'person',
        ),
        occupancy_id,
    )


def resident_claims(user):
    occupancies = list(
        resident_occupancies(user).select_related('unit', 'person')
    )
    if not occupancies:
        return Claim.objects.none()
    condition = Q()
    for occ in occupancies:
        sub = Q(unit_id=occ.unit_id, author_id=occ.person_id)
        if occ.end_date is not None:
            sub &= Q(created_at__date__lte=occ.end_date)
        condition |= sub
    return Claim.objects.filter(condition)


def _parse_month_or_404(raw_month: str) -> date:
    if not isinstance(raw_month, str):
        raise Http404
    try:
        parsed = date.fromisoformat(f'{raw_month}-01')
    except ValueError as exc:
        raise Http404 from exc
    if parsed.strftime('%Y-%m') != raw_month:
        raise Http404
    return parsed


def _message_author_name(message, claim) -> str:
    if message.from_admin:
        full_name = f'{message.author.first_name} {message.author.last_name}'.strip()
        return full_name or claim.building.organization.name
    return str(claim.author)


def _portal_claim_detail_json(claim):
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


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalAccountView(PortalAPIView):
    def get(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        month = month_param(request)
        summary = portal_account_summary(occupancy, month)
        building = occupancy.unit.building
        concept_text = f'Apto {occupancy.unit.number}'
        holder = building.bank_holder or building.organization.name
        pending = None
        if summary.pending_allocation is not None:
            receipt = summary.pending_allocation.receipt
            pending = {
                'id': str(receipt.pk),
                'file': receipt.file_key,
                'date': receipt.transfer_date.isoformat(),
                'amount': money(summary.pending_allocation.amount),
            }
        return Response(
            {
                'id': str(occupancy.pk),
                'name': str(occupancy.person),
                'first_name': occupancy.person.first_name,
                'building': building.name,
                'organization': building.organization.name,
                'unit': occupancy.unit.number,
                'role': occupancy.role,
                'role_note': summary.role_note,
                'status': summary.status,
                'balance': money(summary.balance),
                'charge': money(summary.current_charge),
                'overdue_months': [m.strftime('%Y-%m') for m in summary.overdue_months],
                'unpaid_months': [m.strftime('%Y-%m') for m in summary.unpaid_months],
                'due_day': building.due_day,
                'pending_receipt': pending,
                'concept': concept_text,
                'bank': {
                    'bank_name': building.bank_name,
                    'bank': building.bank_name,
                    'account': building.bank_account,
                    'bank_account': building.bank_account,
                    'holder': holder,
                    'bank_holder': holder,
                    'concept': concept_text,
                },
                'closed': summary.closed,
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalMonthsView(PortalAPIView):
    def get(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        month = month_param(request)
        items = portal_months(occupancy, month)
        return Response(
            {
                'months': [
                    {
                        'month': item['month'].strftime('%Y-%m'),
                        'status': item['status'],
                        'charged': money(item['charged']),
                        'outstanding': money(item['outstanding']),
                    }
                    for item in items
                ]
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalSettlementView(PortalAPIView):
    def get(self, request, occupancy_id, month):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        parsed_month = _parse_month_or_404(month)
        detail = portal_settlement_detail(occupancy, parsed_month)
        if detail is None:
            raise Http404
        return Response(
            {
                'month': detail['month'].strftime('%Y-%m'),
                'role': occupancy.role,
                'coefficient': coefficient(detail['coefficient']),
                'lines': [
                    {
                        'concept': line['concept'],
                        'total': money(line['building_total']),
                        'building_total': money(line['building_total']),
                        'amount': money(line['amount']),
                        'detail': line['detail'],
                        'coefficient': coefficient(line['coefficient']),
                        'days': line['days'],
                        'days_in_month': line['days_in_month'],
                    }
                    for line in detail['lines']
                ],
                'total': money(detail['total']),
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalMovementsView(PortalAPIView):
    def get(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        items = portal_movements(occupancy)
        return Response(
            {
                'movements': [
                    {
                        'id': item['id'],
                        'date': item['date'].isoformat(),
                        'kind': item['kind'],
                        'concept': item['concept'],
                        'debit': money(item['debit']),
                        'credit': money(item['credit']),
                        'balance': money(item['balance']),
                    }
                    for item in items
                ]
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalReceiptsView(PortalAPIView):
    def get(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        allocations = list(
            ReceiptAllocation.objects.filter(occupancy=occupancy)
            .select_related('receipt')
            .order_by('-receipt__transfer_date', '-receipt__created_at', '-pk')
        )
        return Response(
            {
                'receipts': [
                    {
                        'id': str(item.receipt.pk),
                        'month': item.receipt.transfer_date.strftime('%Y-%m'),
                        'amount': money(item.amount),
                        'declared_amount': money(item.receipt.declared_amount),
                        'date': item.receipt.transfer_date.isoformat(),
                        'transfer_date': item.receipt.transfer_date.isoformat(),
                        'file': item.receipt.file_key,
                        'note': item.receipt.note,
                        'status': item.receipt.status,
                        'reason': (
                            item.receipt.rejection_reason
                            if item.receipt.status == Receipt.Status.REJECTED
                            else ''
                        ),
                        'rejection_reason': (
                            item.receipt.rejection_reason
                            if item.receipt.status == Receipt.Status.REJECTED
                            else ''
                        ),
                    }
                    for item in allocations
                ]
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalNoticesView(PortalAPIView):
    def get(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        queryset = Notice.objects.filter(building_id=occupancy.unit.building_id)
        if occupancy.end_date is not None:
            queryset = queryset.filter(created_at__date__lte=occupancy.end_date)
        notices = list(queryset.order_by('-created_at', '-pk'))
        return Response(
            {
                'notices': [
                    {
                        'id': str(item.pk),
                        'title': item.title,
                        'body': item.body,
                        'date': item.created_at.date().isoformat(),
                    }
                    for item in notices
                ]
            }
        )


class PortalOccupancyClaimsView(PortalAPIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        queryset = (
            Claim.objects.filter(unit_id=occupancy.unit_id, author_id=occupancy.person_id)
            .select_related('unit', 'author')
            .prefetch_related('messages')
            .order_by('-created_at', '-pk')
        )
        if occupancy.end_date is not None:
            queryset = queryset.filter(created_at__date__lte=occupancy.end_date)
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
                        'message_count': len(item.messages.all()),
                    }
                    for item in queryset
                ]
            }
        )

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, occupancy_id):
        occupancy = resident_occupancy_or_404(request.user, occupancy_id)
        data = _payload(request)
        raw_kind = _required(data, 'kind')
        if not isinstance(raw_kind, str):
            raise ValidationError('El tipo de reclamo no es válido.')
        kind = KIND_ALIASES.get(raw_kind.strip().lower(), raw_kind.strip())
        raw_title = _required(data, 'title')
        if not isinstance(raw_title, str):
            raise ValidationError('El título debe ser texto.')
        raw_body = data.get('body', '') or ''
        if not isinstance(raw_body, str):
            raise ValidationError('El detalle debe ser texto.')

        claim = communication_services.open_claim(
            occupancy.person,
            occupancy.unit,
            kind,
            raw_title,
            raw_body,
            request.user,
        )
        claim = (
            Claim.objects.select_related('building__organization', 'unit', 'author')
            .prefetch_related('messages__author')
            .get(pk=claim.pk)
        )
        return Response(_portal_claim_detail_json(claim), status=201)


@extend_schema(responses=OpenApiTypes.OBJECT)
class PortalClaimDetailView(PortalAPIView):
    def get(self, request, claim_id):
        claim = get_in_scope_or_404(
            resident_claims(request.user)
            .select_related('building__organization', 'unit', 'author')
            .prefetch_related('messages__author'),
            claim_id,
        )
        return Response(_portal_claim_detail_json(claim))


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
class PortalClaimReplyView(PortalAPIView):
    def post(self, request, claim_id):
        claim = get_in_scope_or_404(
            resident_claims(request.user).select_related(
                'building__organization', 'unit', 'author'
            ),
            claim_id,
        )
        data = _payload(request)
        raw_text = _required(data, 'text')
        if not isinstance(raw_text, str):
            raise ValidationError('El mensaje debe ser texto.')
        message = communication_services.reply_as_resident(
            claim,
            claim.author,
            request.user,
            raw_text,
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
