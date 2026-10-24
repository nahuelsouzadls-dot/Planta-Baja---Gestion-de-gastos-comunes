from django.contrib import admin

from apps.audit.models import RowChange


@admin.register(RowChange)
class RowChangeAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'table_name', 'operation', 'actor', 'request_path')
    list_filter = ('table_name', 'operation', 'actor')
    readonly_fields = [field.name for field in RowChange._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
