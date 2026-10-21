from rest_framework import serializers

from .models import Resident


class ResidentSerializer(serializers.ModelSerializer):
    building_id = serializers.UUIDField(source='building.id', read_only=True)

    class Meta:
        model = Resident
        fields = '__all__'
        read_only_fields = ('id', 'created_at', 'updated_at', 'building_id')
