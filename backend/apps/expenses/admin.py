from django.contrib import admin

from .models import MonthlyExpense


@admin.register(MonthlyExpense)
class MonthlyExpenseAdmin(admin.ModelAdmin):
    list_display = (
        'building', 'billing_month', 'ose_total', 'ute_total', 'cleaning_total',
        'fees_total', 'extraordinary_total', 'reserve_fund_total', 'is_generated',
    )
    list_filter = ('building', 'is_generated', 'billing_month')
    search_fields = ('building__name',)
    readonly_fields = ('id', 'created_at', 'updated_at')
    date_hierarchy = 'billing_month'
