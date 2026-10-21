import uuid

from django.contrib.auth.models import User
from django.db import models


class Resident(models.Model):
    class Role(models.TextChoices):
        TENANT = 'tenant', 'Inquilino'
        OWNER = 'owner', 'Propietario'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.PROTECT, related_name='resident_profile')
    apartment = models.ForeignKey(
        'buildings.Apartment',
        on_delete=models.PROTECT,
        related_name='residents',
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    is_active = models.BooleanField(default=True)
    phone = models.CharField(max_length=30, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['apartment__floor', 'apartment__number', 'role']

    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} ({self.get_role_display()}) — {self.apartment}"

    @property
    def building(self):
        return self.apartment.building
