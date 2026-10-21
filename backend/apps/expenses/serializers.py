from rest_framework import serializers

from .models import MonthlyExpense


class MonthlyExpenseSerializer(serializers.ModelSerializer):
    total_ordinary = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_all = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = MonthlyExpense
        fields = '__all__'
        read_only_fields = ('id', 'created_at', 'updated_at', 'total_ordinary', 'total_all')
