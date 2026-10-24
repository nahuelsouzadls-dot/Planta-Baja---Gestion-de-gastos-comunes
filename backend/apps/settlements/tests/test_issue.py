from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.accounts.models import User
from apps.accounts.models import OrgMembership
from apps.audit.models import RowChange
from apps.buildings.models import ExpenseConcept, Unit
from apps.buildings.services import create_building
from apps.ledger.models import LedgerEntry
from apps.people.models import Occupancy, Person
from apps.settlements.services import issue_settlement, save_draft, settlement_total
from tests.factories import OrganizationFactory
from tests.golden import load_demo


def _people_and_occupancy(unit, organization, role, name, start, end=None):
    person = Person.objects.create(
        organization=organization,
        first_name=name,
        last_name='Test',
    )
    return Occupancy.objects.create(
        unit=unit,
        person=person,
        role=role,
        start_date=start,
        end_date=end,
    )


def _simple_building(user, coefficients=('0.100000', '0.900000')):
    organization = OrganizationFactory()
    OrgMembership.objects.create(user=user, organization=organization)
    building = create_building(
        organization,
        user,
        name='Edificio de prueba',
        address='Prueba 123',
    )
    for index, coefficient in enumerate(coefficients, start=1):
        unit = Unit.objects.create(
            building=building,
            number=str(index),
            floor=1,
            coefficient=coefficient,
        )
        _people_and_occupancy(
            unit,
            building.organization,
            Occupancy.Role.OWNER,
            f'Propietario {index}',
            date(2026, 1, 1),
        )
    return building


@pytest.fixture
def user(db):
    user = User.objects.create_user(email='issuer@example.com', password='test-password-123')
    return user


def test_issue_prorates_move_and_fallback_to_owner(user):
    building = _simple_building(user)
    unit = building.units.get(number='1')
    owner = unit.occupancies.get(role=Occupancy.Role.OWNER)
    first_tenant = _people_and_occupancy(
        unit,
        building.organization,
        Occupancy.Role.TENANT,
        'Inquilino A',
        date(2026, 3, 1),
        date(2026, 3, 14),
    )
    second_tenant = _people_and_occupancy(
        unit,
        building.organization,
        Occupancy.Role.TENANT,
        'Inquilino B',
        date(2026, 3, 15),
    )
    concepts = {concept.name: concept for concept in building.concepts.all()}
    settlement = save_draft(
        building,
        user,
        date(2026, 3, 1),
        {
            concepts['O.S.E. (agua)']: Decimal('3100.00'),
            concepts['Fondo de reserva']: Decimal('1000.00'),
        },
    )

    summary = issue_settlement(settlement, user)

    assert LedgerEntry.objects.get(occupancy=first_tenant, concept=concepts['O.S.E. (agua)']).amount == Decimal('140.00')
    assert LedgerEntry.objects.get(occupancy=second_tenant, concept=concepts['O.S.E. (agua)']).amount == Decimal('170.00')
    assert LedgerEntry.objects.get(occupancy=owner, concept=concepts['Fondo de reserva']).amount == Decimal('100.00')
    assert summary.total_distributed == Decimal('4100.00')


def test_issue_handles_days_without_tenant(user):
    building = _simple_building(user)
    unit = building.units.get(number='1')
    tenant = _people_and_occupancy(
        unit,
        building.organization,
        Occupancy.Role.TENANT,
        'Inquilino',
        date(2026, 3, 10),
    )
    owner = unit.occupancies.get(role=Occupancy.Role.OWNER)
    concept = building.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building, user, date(2026, 3, 1), {concept: Decimal('3100.00')})

    issue_settlement(settlement, user)

    assert LedgerEntry.objects.get(occupancy=owner, concept=concept).amount == Decimal('90.00')
    assert LedgerEntry.objects.get(occupancy=tenant, concept=concept).amount == Decimal('220.00')


def test_issue_splits_owner_on_sale(user):
    building = _simple_building(user)
    unit = building.units.get(number='1')
    first_owner = unit.occupancies.get(role=Occupancy.Role.OWNER)
    first_owner.end_date = date(2026, 3, 15)
    first_owner.save(update_fields=['end_date', 'updated_at'])
    second_owner = _people_and_occupancy(
        unit,
        building.organization,
        Occupancy.Role.OWNER,
        'Propietario nuevo',
        date(2026, 3, 16),
    )
    concept = building.concepts.get(name='Fondo de reserva')
    settlement = save_draft(building, user, date(2026, 3, 1), {concept: Decimal('1000.00')})

    issue_settlement(settlement, user)

    assert LedgerEntry.objects.get(occupancy=first_owner).amount == Decimal('48.39')
    assert LedgerEntry.objects.get(occupancy=second_owner).amount == Decimal('51.61')


def test_issue_errors_are_atomic_and_idempotent(user):
    building = _simple_building(user)
    concept = building.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building, user, date(2026, 3, 1), {concept: Decimal('100.00')})
    issue_settlement(settlement, user)
    with pytest.raises(ValidationError):
        issue_settlement(settlement, user)
    assert LedgerEntry.objects.filter(settlement=settlement).count() == 2

    missing_owner = _simple_building(user, ('1.000000',))
    unit = missing_owner.units.get()
    unit.occupancies.all().delete()
    _people_and_occupancy(
        unit,
        missing_owner.organization,
        Occupancy.Role.TENANT,
        'Sin propietario',
        date(2026, 1, 1),
    )
    concept = missing_owner.concepts.get(name='O.S.E. (agua)')
    settlement =     save_draft(missing_owner, user, date(2026, 3, 1), {concept: Decimal('100.00')})
    with pytest.raises(ValidationError, match='1'):
        issue_settlement(settlement, user)
    assert not LedgerEntry.objects.filter(settlement=settlement).exists()


def test_issue_rejects_coefficients_that_do_not_sum_to_one(user):
    building = _simple_building(user, ('0.100000', '0.800000'))
    concept = building.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building, user, date(2026, 3, 1), {concept: Decimal('100.00')})

    with pytest.raises(ValidationError, match='deben sumar exactamente 1'):
        issue_settlement(settlement, user)

    assert not LedgerEntry.objects.filter(settlement=settlement).exists()


def test_issue_writes_audit_rows(user):
    building = _simple_building(user)
    concept = building.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building, user, date(2026, 3, 1), {concept: Decimal('100.00')})

    issue_settlement(settlement, user)

    assert RowChange.objects.filter(
        table_name='ledger_ledgerentry',
        operation=RowChange.Operation.INSERT,
        actor=user,
    ).exists()
    assert RowChange.objects.filter(
        table_name='settlements_settlement',
        operation=RowChange.Operation.UPDATE,
        actor=user,
        old_values__status='draft',
        new_values__status='issued',
    ).exists()


def test_pocitos_rounding_adjustment(user):
    building = _simple_building(user, tuple(['0.062500'] * 16))
    for index, unit in enumerate(building.units.all(), start=1):
        unit.number = str(100 + index)
        unit.save(update_fields=['number', 'updated_at'])
    concept = building.concepts.get(name='O.S.E. (agua)')
    settlement = save_draft(building, user, date(2026, 8, 1), {concept: Decimal('5350.00')})

    summary = issue_settlement(settlement, user)
    amounts = list(LedgerEntry.objects.filter(settlement=settlement).values_list('amount', flat=True))

    assert sum(amounts, Decimal('0.00')) == Decimal('5350.00')
    assert amounts.count(Decimal('334.38')) == 8
    assert amounts.count(Decimal('334.37')) == 8
    assert summary.rounding_differences[concept.name] == Decimal('0.08')


def _load_golden_or_skip():
    try:
        return load_demo()
    except FileNotFoundError as error:
        pytest.skip(str(error))


def _golden_building(data, user):
    organization = OrganizationFactory()
    OrgMembership.objects.create(user=user, organization=organization)
    building = create_building(
        organization,
        user,
        name=data['name'],
        address='Dirección golden',
    )
    for unit_data in data['units']:
        unit = Unit.objects.create(
            building=building,
            number=unit_data['n'],
            floor=unit_data['floor'],
            coefficient=Decimal(unit_data['coef']),
        )
        _people_and_occupancy(
            unit,
            building.organization,
            Occupancy.Role.OWNER,
            f"Dueño {unit_data['n']}",
            date(2026, 1, 1),
        )
        if f"{unit_data['n']}:tenant" in data['accounts']:
            _people_and_occupancy(
                unit,
                building.organization,
                Occupancy.Role.TENANT,
                f"Inquilino {unit_data['n']}",
                date(2026, 1, 1),
            )
    return building


GOLDEN_CONCEPTS = {
    'ose': 'O.S.E. (agua)',
    'ute': 'U.T.E. (luz)',
    'cleaning': 'Limpieza',
    'fees': 'Honorarios de administración',
    'reserve': 'Fondo de reserva',
    'extraordinary': 'Cuota extraordinaria',
}


def _golden_items(building, expense):
    concepts = {concept.name: concept for concept in building.concepts.all()}
    return {
        concepts[GOLDEN_CONCEPTS[key]]: Decimal(value)
        for key, value in expense.items()
        if key in GOLDEN_CONCEPTS and Decimal(value) > 0
    }


def _golden_details(building, expense):
    if Decimal(expense['extraordinary']) <= 0:
        return {}
    concept = building.concepts.get(name=GOLDEN_CONCEPTS['extraordinary'])
    return {concept: expense['extraordinaryNote'] or 'Detalle golden'}


def test_golden_minas_october_by_account_and_concept(user):
    data = _load_golden_or_skip()
    golden = next(building for building in data['buildings'] if building['id'] == 'minas')
    building = _golden_building(golden, user)
    expense = next(item for item in golden['expenses'] if item['month'] == '2026-10')
    settlement = save_draft(
        building,
        user,
        date(2026, 10, 1),
        _golden_items(building, expense),
        details=_golden_details(building, expense),
    )

    issue_settlement(settlement, user)

    for account, expected in golden['chargesByMonth']['2026-10'].items():
        unit_number, role = account.split(':')
        occupancy = Occupancy.objects.get(unit__building=building, unit__number=unit_number, role=role)
        entries = LedgerEntry.objects.filter(occupancy=occupancy, settlement=settlement)
        assert sum(entries.values_list('amount', flat=True), Decimal('0.00')) == Decimal(expected['charge'])
        for line in expected['lines']:
            actual = sum(
                entries.filter(concept__name=line['label']).values_list('amount', flat=True),
                Decimal('0.00'),
            )
            assert actual == Decimal(line['amount'])

def test_golden_all_buildings_and_months_balance_exactly(user):
    data = _load_golden_or_skip()
    for golden in data['buildings']:
        building = _golden_building(golden, user)
        for expense in golden['expenses']:
            if expense['status'] != 'emitido':
                continue
            settlement = save_draft(
                building,
                user,
                date.fromisoformat(f"{expense['month']}-01"),
                _golden_items(building, expense),
                details=_golden_details(building, expense),
            )
            summary = issue_settlement(settlement, user)
            assert summary.total_distributed == settlement_total(settlement)
            for item in settlement.items.all():
                assert sum(
                    LedgerEntry.objects.filter(
                        settlement=settlement,
                        concept=item.concept,
                    ).values_list('amount', flat=True),
                    Decimal('0.00'),
                ) == item.amount
