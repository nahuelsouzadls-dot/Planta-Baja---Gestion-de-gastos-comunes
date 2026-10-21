from django.contrib import admin

from .models import Movement


@admin.register(Movement)
class MovementAdmin(admin.ModelAdmin):
    list_display = (
        'resident', 'date', 'movement_type', 'amount', 'payment_status', 'monthly_expense', 'created_at',
    )
    list_filter = ('movement_type', 'payment_status', 'date', 'resident__apartment__building')
    search_fields = ('resident__user__username', 'resident__user__first_name', 'notes')
    readonly_fields = ('id', 'created_at')
    date_hierarchy = 'date'

    def has_change_permission(self, request, obj=None):
        # Movements are immutable — disable the change form in admin.
        return False

    def has_delete_permission(self, request, obj=None):
        return False
