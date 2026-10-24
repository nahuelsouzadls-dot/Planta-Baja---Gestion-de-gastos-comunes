from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.core.models import UUIDModel


class SettlementDocument(UUIDModel):
    """PDF de una liquidación emitida: del edificio (sin ocupación) o de una unidad.

    Es inmutable como la liquidación: una corrección es un ajuste en el libro mayor,
    nunca un PDF nuevo encima del emitido (D4).
    """

    settlement = models.ForeignKey(
        'settlements.Settlement', on_delete=models.PROTECT, related_name='documents'
    )
    occupancy = models.ForeignKey(
        'people.Occupancy', null=True, blank=True, on_delete=models.PROTECT, related_name='+'
    )
    file_key = models.CharField(max_length=150, unique=True)
    file_sha256 = models.CharField(max_length=64)
    size_bytes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['settlement'],
                condition=Q(occupancy__isnull=True),
                name='settlement_document_one_per_building',
            ),
            models.UniqueConstraint(
                fields=['settlement', 'occupancy'],
                condition=Q(occupancy__isnull=False),
                name='settlement_document_one_per_occupancy',
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('El PDF de una liquidación emitida no se reemplaza.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('El PDF de una liquidación emitida no se borra.')
