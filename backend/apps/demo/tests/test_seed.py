from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import call_command, CommandError
from django.test import override_settings

from apps.accounts.models import Organization, User
from apps.audit.models import AuditLog
from apps.ledger.models import LedgerEntry, Receipt
from apps.ledger.reports import portfolio_totals


GOLDEN = Path('/golden/demo.json')
if not GOLDEN.exists():
    GOLDEN = Path(__file__).resolve().parents[4] / 'docs' / 'golden' / 'demo.json'

pytestmark = pytest.mark.django_db


def seed(monkeypatch):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    call_command('seed_demo', golden=str(GOLDEN))


def test_seed_matches_front_portfolio(monkeypatch, capsys):
    with override_settings(DEBUG=True):
        seed(monkeypatch)

    totals = portfolio_totals(Organization.objects.get(), date(2026, 10, 1))
    assert totals.accounts == 49
    assert totals.expected == Decimal('73830.00')
    assert totals.collected == Decimal('42024.90')
    assert totals.in_review == Decimal('11034.75')
    assert totals.debt == Decimal('18120.32')
    assert totals.delinquent == 4
    assert totals.open_claims == 2
    assert 'Cartera:' in capsys.readouterr().out


def test_seed_requires_development_and_password(monkeypatch):
    monkeypatch.delenv('DEMO_PASSWORD', raising=False)
    with override_settings(DEBUG=False):
        with pytest.raises(CommandError, match='solo corre en desarrollo'):
            call_command('seed_demo', golden=str(GOLDEN))
    with override_settings(DEBUG=True):
        with pytest.raises(CommandError, match='DEMO_PASSWORD'):
            call_command('seed_demo', golden=str(GOLDEN))


def test_seed_is_not_repeatable(monkeypatch):
    with override_settings(DEBUG=True):
        seed(monkeypatch)
        with pytest.raises(CommandError, match='base sin organizaciones'):
            seed(monkeypatch)
    assert Organization.objects.count() == 1


def test_seed_records_actors_and_uploaders(monkeypatch):
    with override_settings(DEBUG=True):
        seed(monkeypatch)

    maria = User.objects.get(email='maria@admin.demo')
    pablo = User.objects.get(email='pablo@admin.demo')
    assert not LedgerEntry.objects.filter(kind='charge', created_by=pablo).exists()
    assert not LedgerEntry.objects.filter(kind='payment', created_by=maria).exists()
    assert Receipt.objects.filter(
        person__first_name='María',
        person__last_name='García',
        uploaded_by__email='maria.garcia@correo.com.uy',
    ).exists()
    assert AuditLog.objects.filter(actor=maria).exists()
