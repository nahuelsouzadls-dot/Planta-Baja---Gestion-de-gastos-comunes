from datetime import date
from decimal import Decimal
import importlib
import pytest
from django.db import IntegrityError, DatabaseError, transaction
from django.urls import reverse
from axes.models import AccessAttempt

from apps.accounts.models import User, Organization
from apps.buildings.models import Unit
from apps.buildings.services import create_building
from apps.people.models import Occupancy, Person
from apps.people.services import days_in_month, occupancies_in_month, owner_gaps
from apps.settlements.models import Settlement, SettlementItem
from apps.settlements.services import save_draft, issue_settlement, settlement_total
from apps.ledger.models import LedgerEntry
from apps.ledger.services import record_opening


@pytest.mark.django_db
def test_1_axes_unlimited_bruteforce_and_shared_null_username_on_admin_login(client):
    User.objects.create_superuser('victim@example.com', 'strong-password-123')

    for i in range(20):
        resp = client.post(
            reverse('admin:login'),
            {
                'username': 'victim@example.com',
                'email': f'decoy-{i}@example.com',
                'password': f'wrong-password-{i}',
            },
            REMOTE_ADDR='10.0.0.50',
        )
        assert resp.status_code == 200

    resp_ok = client.post(
        reverse('admin:login'),
        {
            'username': 'victim@example.com',
            'email': 'decoy-final@example.com',
            'password': 'strong-password-123',
        },
        REMOTE_ADDR='10.0.0.50',
    )
    assert resp_ok.status_code == 302

    client.logout()
    client.post(
        reverse('admin:login'),
        {'username': 'victim@example.com', 'password': 'wrong'},
        REMOTE_ADDR='10.0.0.51',
    )
    attempt = AccessAttempt.objects.get(ip_address='10.0.0.51')
    assert attempt.username is None


@pytest.mark.django_db
def test_2_settlement_item_immutable_trigger_bypassed_by_moving_to_draft():
    org = Organization.objects.create(name='Org')
    building = create_building(org, name='Edificio', address='Calle 1')
    unit = Unit.objects.create(building=building, number='101', floor=1, coefficient=Decimal('1.000000'))
    person = Person.objects.create(organization=org, first_name='A', last_name='B')
    Occupancy.objects.create(unit=unit, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1))
    user = User.objects.create_user('u@example.com', 'strong-password-123')

    concept = building.concepts.get(name='Limpieza')
    issued = save_draft(building, date(2026, 10, 1), {concept: Decimal('1000.00')})
    issue_settlement(issued, user)
    item = issued.items.get()

    draft = save_draft(building, date(2026, 11, 1), {building.concepts.get(name='O.S.E. (agua)'): Decimal('500.00')})

    SettlementItem.objects.filter(pk=item.pk).update(settlement=draft, amount=Decimal('1.00'))
    SettlementItem.objects.filter(pk=item.pk).delete()

    assert issued.items.count() == 0
    assert settlement_total(issued) == Decimal('0.00')


@pytest.mark.django_db
def test_3_settlement_admin_allows_issuing_without_ledger_entries_and_500_on_add(client):
    admin = User.objects.create_superuser('admin2@example.com', 'strong-password-123')
    client.force_login(admin)
    org = Organization.objects.create(name='Org')
    building = create_building(org, name='Edificio', address='Calle 1')
    concept = building.concepts.get(name='Limpieza')
    draft = save_draft(building, date(2026, 10, 1), {concept: Decimal('1000.00')})
    item = draft.items.get()

    resp = client.post(
        reverse('admin:settlements_settlement_change', args=[draft.pk]),
        {
            'building': str(building.pk),
            'month': '2026-10-01',
            'status': 'issued',
            'issued_at_0': '2026-10-01',
            'issued_at_1': '12:00:00',
            'issued_by': str(admin.pk),
            'items-TOTAL_FORMS': '1',
            'items-INITIAL_FORMS': '1',
            'items-MIN_NUM_FORMS': '0',
            'items-MAX_NUM_FORMS': '1000',
            'items-0-id': str(item.pk),
            'items-0-settlement': str(draft.pk),
            'items-0-concept': str(concept.pk),
            'items-0-amount': '1000.00',
            'items-0-detail': '',
        },
    )
    assert resp.status_code == 302
    draft.refresh_from_db()
    assert draft.status == Settlement.Status.ISSUED
    assert LedgerEntry.objects.filter(settlement=draft).count() == 0

    with pytest.raises(DatabaseError):
        with transaction.atomic():
            client.post(
                reverse('admin:settlements_settlement_add'),
                {
                    'building': str(building.pk),
                    'month': '2026-11-01',
                    'status': 'issued',
                    'issued_at_0': '2026-11-01',
                    'issued_at_1': '12:00:00',
                    'issued_by': str(admin.pk),
                    'items-TOTAL_FORMS': '1',
                    'items-INITIAL_FORMS': '0',
                    'items-MIN_NUM_FORMS': '0',
                    'items-MAX_NUM_FORMS': '1000',
                    'items-0-concept': str(concept.pk),
                    'items-0-amount': '1000.00',
                    'items-0-detail': '',
                },
            )


@pytest.mark.django_db
def test_4_ledger_entry_constraints_accept_invalid_combinations():
    org = Organization.objects.create(name='Org')
    building = create_building(org, name='Edificio', address='Calle 1')
    other_building = create_building(org, name='Otro Edificio', address='Calle 2')
    unit = Unit.objects.create(building=building, number='101', floor=1, coefficient=Decimal('1.000000'))
    person = Person.objects.create(organization=org, first_name='A', last_name='B')
    occ = Occupancy.objects.create(unit=unit, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1))
    user = User.objects.create_user('u4@example.com', 'strong-password-123')
    other_settlement = Settlement.objects.create(building=other_building, month=date(2026, 10, 1))
    other_concept = other_building.concepts.first()

    e1 = LedgerEntry.objects.create(
        occupancy=occ,
        date=date(2026, 10, 1),
        kind='invalido',
        amount=Decimal('-123.45'),
        days=999,
        days_in_month=None,
        created_by=user,
    )
    assert e1.pk is not None

    e2 = LedgerEntry.objects.create(
        occupancy=occ,
        date=date(2026, 10, 1),
        kind=LedgerEntry.Kind.CHARGE,
        amount=Decimal('100.00'),
        settlement=other_settlement,
        concept=other_concept,
        base_amount=Decimal('-9999.00'),
        coefficient=Decimal('9.999999'),
        days=31,
        days_in_month=31,
        adjusts=e1,
        created_by=user,
    )
    assert e2.pk is not None


@pytest.mark.django_db
def test_5_decimal_sub_cent_inputs_and_missing_quantize():
    org = Organization.objects.create(name='Org')
    building = create_building(org, name='Edificio', address='Calle 1')
    unit = Unit.objects.create(building=building, number='101', floor=1, coefficient=Decimal('1.000000'))
    person = Person.objects.create(organization=org, first_name='A', last_name='B')
    occ = Occupancy.objects.create(unit=unit, person=person, role=Occupancy.Role.OWNER, start_date=date(2026, 1, 1))
    user = User.objects.create_user('u5@example.com', 'strong-password-123')
    concept = building.concepts.get(name='Limpieza')

    settlement = save_draft(building, date(2026, 10, 1), {concept: Decimal('0.004')})
    assert settlement.items.get().amount == Decimal('0.00')
    assert settlement_total(settlement) == Decimal('0.00')

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            record_opening(occ, Decimal('0.004'), date(2026, 10, 1), user)


@pytest.mark.django_db
def test_6_days_in_month_and_owner_gaps_fail_when_month_day_is_not_1():
    org = Organization.objects.create(name='Org')
    building = create_building(org, name='Edificio', address='Calle 1')
    unit = Unit.objects.create(building=building, number='101', floor=1, coefficient=Decimal('1.000000'))
    person = Person.objects.create(organization=org, first_name='A', last_name='B')
    occ = Occupancy.objects.create(
        unit=unit,
        person=person,
        role=Occupancy.Role.OWNER,
        start_date=date(2028, 1, 1),
        end_date=None,
    )

    assert days_in_month(occ, date(2028, 2, 1)) == 29
    assert days_in_month(occ, date(2028, 2, 29)) == 1
    assert owner_gaps(unit, date(2028, 2, 29)) == 28

    closed_early = Occupancy.objects.create(
        unit=unit,
        person=person,
        role=Occupancy.Role.TENANT,
        start_date=date(2028, 2, 1),
        end_date=date(2028, 2, 10),
    )
    assert days_in_month(closed_early, date(2028, 2, 15)) == 0
    assert closed_early not in [o for o, _ in occupancies_in_month(unit, date(2028, 2, 15))]


@pytest.mark.django_db
def test_7_create_user_accepts_whitespace_only_email_and_update_breaks_login():
    u = User.objects.create_user('   ', 'strong-password-123')
    assert u.email == ''

    u2 = User.objects.create_user('valid@example.com', 'strong-password-123')
    User.objects.filter(pk=u2.pk).update(email='Valid@Example.com')
    with pytest.raises(User.DoesNotExist):
        User.objects.get_by_natural_key('valid@example.com')


def test_8_production_settings_accept_weak_secret_key_and_lack_csrf_trusted_origins(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'change-me')
    import config.settings.base as base_settings
    import config.settings.production as prod_settings
    importlib.reload(base_settings)
    importlib.reload(prod_settings)
    assert prod_settings.SECRET_KEY == 'change-me'
    assert getattr(prod_settings, 'CSRF_TRUSTED_ORIGINS', []) == []
