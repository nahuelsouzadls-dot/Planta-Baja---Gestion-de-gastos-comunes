from django.contrib import admin

from .models import LedgerEntry, Receipt, ReceiptAllocation


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ('date', 'occupancy', 'kind', 'amount', 'created_by')
    list_filter = ('kind',)
    list_select_related = ('occupancy', 'created_by')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class ReceiptAllocationInline(admin.TabularInline):
    model = ReceiptAllocation
    extra = 0
    can_delete = False
    readonly_fields = ('receipt', 'occupancy', 'amount', 'created_at', 'updated_at')

    def has_add_permission(self, request, obj=None):
        return False


class ReceiptPaymentInline(admin.TabularInline):
    model = LedgerEntry
    fk_name = 'receipt'
    extra = 0
    can_delete = False
    readonly_fields = (
        'occupancy', 'date', 'kind', 'amount', 'created_by', 'description', 'created_at',
    )
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'person', 'declared_amount', 'status', 'transfer_date')
    list_filter = ('status',)
    readonly_fields = [field.name for field in Receipt._meta.fields]
    inlines = [ReceiptAllocationInline, ReceiptPaymentInline]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
