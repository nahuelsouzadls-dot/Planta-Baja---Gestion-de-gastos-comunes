from django.contrib import admin

from .models import Settlement, SettlementItem


class SettlementItemInline(admin.TabularInline):
    model = SettlementItem
    extra = 0

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.status == Settlement.Status.ISSUED:
            return ('settlement', 'concept', 'amount', 'detail')
        return ()

    def has_delete_permission(self, request, obj=None):
        return obj is None or obj.status != Settlement.Status.ISSUED


@admin.register(Settlement)
class SettlementAdmin(admin.ModelAdmin):
    list_display = ('building', 'month', 'status', 'issued_at', 'issued_by')
    list_filter = ('status', 'building')
    list_select_related = ('building', 'issued_by')
    inlines = (SettlementItemInline,)

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.status == Settlement.Status.ISSUED:
            return ('building', 'month', 'status', 'issued_at', 'issued_by')
        return ()

    def has_change_permission(self, request, obj=None):
        if obj is not None and obj.status == Settlement.Status.ISSUED:
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.status == Settlement.Status.ISSUED:
            return False
        return super().has_delete_permission(request, obj)
