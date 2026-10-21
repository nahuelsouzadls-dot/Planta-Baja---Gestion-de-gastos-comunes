from rest_framework import serializers

from .models import Apartment, Building


class BuildingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Building
        fields = '__all__'
        read_only_fields = ('id', 'created_at', 'updated_at')


class ApartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Apartment
        fields = '__all__'
        read_only_fields = ('id', 'created_at', 'updated_at')
