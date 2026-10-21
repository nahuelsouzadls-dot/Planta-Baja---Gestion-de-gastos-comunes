import uuid

from django.db import models


class Building(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    address = models.CharField(max_length=300)
    city = models.CharField(max_length=100, default='Montevideo')
    country = models.CharField(max_length=100, default='Uruguay')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} — {self.address}"


class Apartment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='apartments',
    )
    number = models.CharField(max_length=20)
    floor = models.IntegerField()
    ownership_coefficient = models.DecimalField(max_digits=10, decimal_places=8)
    is_rented = models.BooleanField(default=False)
    receives_paper = models.BooleanField(default=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('building', 'number')
        ordering = ['floor', 'number']

    def __str__(self):
        return f"Apto {self.number} — {self.building.name}"
