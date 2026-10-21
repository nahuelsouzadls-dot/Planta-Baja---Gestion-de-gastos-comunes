from datetime import date
from decimal import Decimal

import pytest

from apps.expenses.models import MonthlyExpense


@pytest.mark.django_db
class TestMonthlyExpenseModel:
    def test_total_ordinary(self, monthly_expense):
        expected = Decimal('1200.00') + Decimal('3400.00') + Decimal('4500.00') + Decimal('8000.00')
        assert monthly_expense.total_ordinary == expected

    def test_total_all_with_extras(self, building):
        expense = MonthlyExpense.objects.create(
            building=building,
            billing_month=date(2026, 11, 1),
            ose_total=Decimal('1000.00'),
            ute_total=Decimal('2000.00'),
            cleaning_total=Decimal('3000.00'),
            fees_total=Decimal('4000.00'),
            extraordinary_total=Decimal('500.00'),
            reserve_fund_total=Decimal('200.00'),
        )
        assert expense.total_all == Decimal('10700.00')

    def test_unique_together_building_billing_month(self, monthly_expense, building):
        from django.db import IntegrityError
        with pytest.raises(IntegrityError):
            MonthlyExpense.objects.create(
                building=building,
                billing_month=date(2026, 10, 1),
            )

    def test_str(self, monthly_expense):
        assert '2026-10' in str(monthly_expense)
