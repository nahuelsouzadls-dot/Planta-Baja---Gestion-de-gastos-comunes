from django.contrib import admin

from apps.audit.models import AuditLog, RowChange


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


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'organization', 'actor', 'action', 'summary')
    list_filter = ('organization', 'actor', 'action', 'created_at')
    search_fields = ('summary',)
    readonly_fields = [field.name for field in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
