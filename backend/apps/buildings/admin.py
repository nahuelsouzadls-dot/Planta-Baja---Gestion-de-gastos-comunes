from django.contrib import admin

from .models import Building, ExpenseConcept, Unit


class UnitInline(admin.TabularInline):
    model = Unit
    extra = 0


class ExpenseConceptInline(admin.TabularInline):
    model = ExpenseConcept
    extra = 0


@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    list_display = ('name', 'organization', 'city', 'due_day', 'is_active')
    list_select_related = ('organization',)
    search_fields = ('name', 'address', 'organization__name')
    inlines = (UnitInline, ExpenseConceptInline)


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ('number', 'building', 'floor', 'coefficient', 'receives_paper')
    list_select_related = ('building',)
    search_fields = ('number', 'building__name')


@admin.register(ExpenseConcept)
class ExpenseConceptAdmin(admin.ModelAdmin):
    list_display = ('name', 'building', 'kind', 'is_reserve_fund', 'order', 'is_active')
    list_select_related = ('building',)
    search_fields = ('name', 'building__name')
