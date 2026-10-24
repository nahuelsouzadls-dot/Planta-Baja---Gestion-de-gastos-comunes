from rest_framework import serializers

from apps.accounts.models import Organization
from apps.buildings.models import Building, Unit
from apps.people.models import Occupancy


class OrganizationSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Organization
        fields = ('id', 'name')


class BuildingListSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    units = serializers.SerializerMethodField()

    class Meta:
        model = Building
        fields = ('id', 'name', 'address', 'units')

    def get_units(self, obj):
        return obj.units.count()


class UnitSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    coefficient = serializers.DecimalField(
        max_digits=7, decimal_places=6, coerce_to_string=True, read_only=True
    )

    class Meta:
        model = Unit
        fields = ('id', 'number', 'floor', 'coefficient')


class BuildingDetailSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    units = UnitSerializer(many=True, read_only=True)

    class Meta:
        model = Building
        fields = ('id', 'name', 'address', 'units')


class OccupancySerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    unit = serializers.CharField(source='unit.number', read_only=True)
    building = serializers.CharField(source='unit.building.name', read_only=True)
    closed = serializers.SerializerMethodField()

    class Meta:
        model = Occupancy
        fields = ('id', 'unit', 'building', 'role', 'start_date', 'end_date', 'closed')

    def get_closed(self, obj):
        return obj.end_date is not None
