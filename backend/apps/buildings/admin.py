from django.contrib import admin

from .models import Apartment, Building


@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    list_display = ('name', 'address', 'city', 'country', 'is_active', 'created_at')
    list_filter = ('is_active', 'city', 'country')
    search_fields = ('name', 'address')
    readonly_fields = ('id', 'created_at', 'updated_at')


@admin.register(Apartment)
class ApartmentAdmin(admin.ModelAdmin):
    list_display = ('number', 'floor', 'building', 'ownership_coefficient', 'is_rented', 'receives_paper')
    list_filter = ('building', 'is_rented', 'receives_paper', 'floor')
    search_fields = ('number', 'building__name')
    readonly_fields = ('id', 'created_at', 'updated_at')
