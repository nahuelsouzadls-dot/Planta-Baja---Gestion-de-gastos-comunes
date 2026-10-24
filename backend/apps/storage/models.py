from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import TimeStampedModel


class UploadIntent(TimeStampedModel):
    """Permiso de un solo uso para subir un archivo directo al almacenamiento (ADR-0012)."""

    file_key = models.CharField(max_length=100, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    occupancy = models.ForeignKey('people.Occupancy', on_delete=models.PROTECT, related_name='+')
    content_type = models.CharField(max_length=50)
    size_bytes = models.PositiveIntegerField()
    filename = models.CharField(max_length=120, blank=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(size_bytes__gte=1) & Q(size_bytes__lte=10485760),
                name='upload_intent_size_valid',
            ),
        ]
        indexes = [
            models.Index(fields=['consumed_at', 'expires_at'], name='upload_intent_pending_idx'),
        ]

    def __str__(self):
        return self.file_key
