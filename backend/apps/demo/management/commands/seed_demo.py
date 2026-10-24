import json
import os
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import OrgMembership, Organization
from apps.accounts.models import User
from apps.buildings.services import create_building
from apps.communications.models import Claim
from apps.communications.services import (
    open_claim,
    publish_notice,
    reply_as_admin,
    reply_as_resident,
    set_claim_status,
)
from apps.ledger.payments import record_manual_payment, submit_receipt
from apps.ledger.models import LedgerEntry
from apps.people.services import create_person, move_in
from apps.settlements.services import issue_settlement, save_draft


def _split_name(name):
    first, last = name.split(' ', 1)
    return first, last


def _content_type(file_name):
    return 'application/pdf' if file_name.lower().endswith('.pdf') else 'image/jpeg'


class Command(BaseCommand):
    help = 'Carga la demo completa desde el golden del front.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--golden',
            dest='golden_path',
            default=os.environ.get('GOLDEN_PATH', '/golden/demo.json'),
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('seed_demo solo corre en desarrollo')
        password = os.environ.get('DEMO_PASSWORD')
        if not password or len(password) < 10:
            raise CommandError('DEMO_PASSWORD es obligatoria y debe tener al menos 10 caracteres')
        if Organization.objects.exists():
            raise CommandError(
                'La demo solo se carga sobre una base sin organizaciones; '
                'para empezar de cero ejecutá docker compose down -v'
            )

        try:
            with Path(options['golden_path']).open(encoding='utf-8') as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError) as error:
            raise CommandError(f'No se pudo leer el golden: {error}') from error

        with transaction.atomic():
            organization = Organization.objects.create(
                name=data['company']['name'],
                email=data['company']['email'],
            )
            maria = User.objects.create_user(
                'maria@confort.demo',
                password,
                first_name='María',
                last_name='Fernández',
            )
            pablo = User.objects.create_user(
                'pablo@confort.demo',
                password,
                first_name='Pablo',
                last_name='Suárez',
            )
            OrgMembership.objects.create(user=maria, organization=organization)
            OrgMembership.objects.create(user=pablo, organization=organization)

            buildings = {}
            units = {}
            people = {}
            occupancies = {}
            for building_data in data['buildings']:
                building = create_building(
                    organization,
                    name=building_data['name'],
                    address=building_data['address'],
                    neighborhood=building_data['barrio'],
                    bank_name=building_data['bank'].split(' · ', 1)[0],
                    bank_account='Cuenta corriente en pesos',
                    bank_holder=organization.name,
                    due_day=data['meta']['dueDay'],
                    reserve_opening=Decimal(building_data['reserveOpening']),
                    opening_date=date.fromisoformat(data['meta']['today']),
                )
                buildings[building_data['id']] = building
                for unit_data in building_data['units']:
                    unit = building.units.create(
                        number=unit_data['n'],
                        floor=unit_data['floor'],
                        coefficient=Decimal(unit_data['coef']),
                    )
                    units[(building_data['id'], unit_data['n'])] = unit
                    for role in ('owner', 'tenant'):
                        person_data = unit_data.get(role)
                        if not person_data:
                            continue
                        person = people.get(person_data['name'])
                        if person is None:
                            first, last = _split_name(person_data['name'])
                            person = create_person(
                                organization,
                                first_name=first,
                                last_name=last,
                                email=person_data['email'],
                                phone=person_data['phone'],
                            )
                            people[person_data['name']] = person
                        occupancy = move_in(
                            unit,
                            person,
                            role,
                            date(2026, 1, 1),
                            maria,
                        )
                        occupancies[(building_data['id'], unit_data['n'], role)] = occupancy

            for name, email in (
                ('Juan Pérez', 'juan.perez@correo.com.uy'),
                ('María García', 'maria.garcia@correo.com.uy'),
            ):
                person = people[name]
                resident = User.objects.create_user(
                    email,
                    password,
                    first_name=person.first_name,
                    last_name=person.last_name,
                )
                person.user = resident
                person.save(update_fields=['user', 'updated_at'])

            concepts = {}
            for building_id, building in buildings.items():
                concepts[building_id] = {
                    concept.name: concept for concept in building.concepts.all()
                }
                building_data = next(
                    item for item in data['buildings'] if item['id'] == building_id
                )
                for expense in building_data['expenses']:
                    amounts = {
                        concepts[building_id]['O.S.E. (agua)']: Decimal(expense['ose']),
                        concepts[building_id]['U.T.E. (luz)']: Decimal(expense['ute']),
                        concepts[building_id]['Limpieza']: Decimal(expense['cleaning']),
                        concepts[building_id]['Honorarios de administración']: Decimal(expense['fees']),
                        concepts[building_id]['Fondo de reserva']: Decimal(expense['reserve']),
                        concepts[building_id]['Cuota extraordinaria']: Decimal(expense['extraordinary']),
                    }
                    details = {}
                    if expense['extraordinary']:
                        details[concepts[building_id]['Cuota extraordinaria']] = expense[
                            'extraordinaryNote'
                        ]
                    settlement = save_draft(
                        building,
                        date.fromisoformat(f"{expense['month']}-01"),
                        amounts,
                        details=details,
                    )
                    if expense['status'] == 'emitido':
                        issue_settlement(settlement, maria)

            for building_data in data['buildings']:
                for key, account in building_data['accounts'].items():
                    number, role = key.split(':')
                    occupancy = occupancies[(building_data['id'], number, role)]
                    for movement in account['movements']:
                        if movement['credit'] != '0.00':
                            record_manual_payment(
                                occupancy,
                                Decimal(movement['credit']),
                                date.fromisoformat(movement['date']),
                                pablo,
                                f"Extracto Scotiabank {movement['date']}",
                            )

                    review = account.get('review')
                    if review:
                        uploaded_by = occupancy.person.user or pablo
                        submit_receipt(
                            occupancy.person,
                            uploaded_by,
                            file_key=review['file'],
                            file_sha256='b' * 64,
                            content_type=_content_type(review['file']),
                            size_bytes=1,
                            declared_amount=Decimal(account['balance']),
                            transfer_date=date.fromisoformat(review['uploadedAt']),
                            allocations={occupancy: Decimal(account['balance'])},
                        )

                for notice_data in building_data.get('notices', []):
                    publish_notice(
                        buildings[building_data['id']],
                        maria,
                        notice_data['title'],
                        notice_data['body'],
                    )

                for thread in building_data.get('threads', []):
                    person = people[thread['author']]
                    resident = person.user
                    if resident is None:
                        resident = User.objects.create_user(
                            f"{thread['author'].lower().replace(' ', '.').replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u')}@residentes.demo",
                            password,
                            first_name=person.first_name,
                            last_name=person.last_name,
                        )
                        person.user = resident
                        person.save(update_fields=['user', 'updated_at'])
                    unit = units[(building_data['id'], thread['unit'])]
                    claim = open_claim(
                        person,
                        unit,
                        Claim.Kind.COMPLAINT if thread['kind'] == 'reclamo' else Claim.Kind.REPORT,
                        thread['title'],
                        thread['messages'][0]['text'],
                        resident,
                    )
                    for message in thread['messages'][1:]:
                        if message['from'] == 'admin':
                            reply_as_admin(claim, maria, message['text'])
                        else:
                            reply_as_resident(claim, person, resident, message['text'])
                    claim.refresh_from_db()
                    desired = {
                        'pendiente': Claim.Status.PENDING,
                        'en-proceso': Claim.Status.IN_PROGRESS,
                        'resuelto': Claim.Status.RESOLVED,
                    }[thread['status']]
                    if desired == Claim.Status.RESOLVED and claim.status == Claim.Status.PENDING:
                        claim = set_claim_status(claim, maria, Claim.Status.IN_PROGRESS)
                    if claim.status != desired:
                        set_claim_status(claim, maria, desired)

            from apps.ledger.reports import portfolio_totals

            totals = portfolio_totals(
                organization, date.fromisoformat(f"{data['meta']['currentMonth']}-01")
            )

        self.stdout.write(
            'Demo cargada: organizaciones=1, edificios={}, unidades={}, cuentas={}, '
            'cargos={}, pagos={}, comprobantes_en_revision={}, avisos={}, reclamos={}'.format(
                len(buildings),
                sum(len(building.units.all()) for building in buildings.values()),
                len(occupancies),
                sum(
                    LedgerEntry.objects.filter(
                        occupancy__unit__building=building,
                        kind=LedgerEntry.Kind.CHARGE,
                    ).count()
                    for building in buildings.values()
                ),
                sum(
                    LedgerEntry.objects.filter(
                        occupancy__unit__building=building,
                        kind=LedgerEntry.Kind.PAYMENT,
                    ).count()
                    for building in buildings.values()
                ),
                sum(
                    building_data['accounts'][key].get('review') is not None
                    for building_data in data['buildings']
                    for key in building_data['accounts']
                ),
                sum(len(building_data.get('notices', [])) for building_data in data['buildings']),
                sum(len(building_data.get('threads', [])) for building_data in data['buildings']),
            )
        )
        self.stdout.write(
            'Cartera: accounts={}, expected={}, collected={}, in_review={}, debt={}, '
            'delinquent={}, open_claims={}'.format(
                totals.accounts,
                totals.expected,
                totals.collected,
                totals.in_review,
                totals.debt,
                totals.delinquent,
                totals.open_claims,
            )
        )
