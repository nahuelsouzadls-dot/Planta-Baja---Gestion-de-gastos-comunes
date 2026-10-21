from django.contrib import admin

from .models import Resident


@admin.register(Resident)
class ResidentAdmin(admin.ModelAdmin):
    list_display = ('user', 'apartment', 'role', 'is_active', 'phone', 'created_at')
    list_filter = ('role', 'is_active', 'apartment__building')
    search_fields = ('user__username', 'user__first_name', 'user__last_name', 'user__email', 'apartment__number')
    readonly_fields = ('id', 'created_at', 'updated_at')
    raw_id_fields = ('user', 'apartment')
