from rest_framework import serializers

from .models import Movement


class MovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Movement
        fields = '__all__'
        read_only_fields = ('id', 'created_at')

    def update(self, instance, validated_data):
        raise serializers.ValidationError(
            "Los movimientos son inmutables. Crea un asiento de ajuste."
        )
