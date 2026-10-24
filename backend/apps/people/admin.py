from django.contrib import admin

from .models import Occupancy, Person


class OccupancyInline(admin.TabularInline):
    model = Occupancy
    extra = 0


@admin.register(Person)
class PersonAdmin(admin.ModelAdmin):
    list_display = ('last_name', 'first_name', 'email', 'organization')
    list_filter = ('organization',)
    list_select_related = ('organization', 'user')
    search_fields = ('first_name', 'last_name', 'email', 'document')
    inlines = (OccupancyInline,)


@admin.register(Occupancy)
class OccupancyAdmin(admin.ModelAdmin):
    list_display = ('unit', 'person', 'role', 'start_date', 'end_date')
    list_filter = ('role',)
    list_select_related = ('unit', 'person', 'unit__building')
    search_fields = ('unit__number', 'person__first_name', 'person__last_name')
