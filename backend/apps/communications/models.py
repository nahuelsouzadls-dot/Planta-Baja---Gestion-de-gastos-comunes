from django.conf import settings
from django.db import models

from apps.accounts.models import Organization
from apps.buildings.models import Building, Unit
from apps.core.models import TimeStampedModel, UUIDModel
from apps.people.models import Person


class Notice(TimeStampedModel):
    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='notices',
    )
    title = models.CharField(max_length=120)
    body = models.TextField()
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='+',
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['building', 'created_at']),
        ]

    def __str__(self):
        return self.title


class Claim(TimeStampedModel):
    class Kind(models.TextChoices):
        REPORT = 'report', 'Reporte'
        COMPLAINT = 'complaint', 'Reclamo'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Recibido'
        IN_PROGRESS = 'in_progress', 'En proceso'
        RESOLVED = 'resolved', 'Resuelto'

    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='claims',
    )
    unit = models.ForeignKey(
        Unit,
        on_delete=models.PROTECT,
        related_name='claims',
    )
    author = models.ForeignKey(
        Person,
        on_delete=models.PROTECT,
        related_name='claims',
    )
    kind = models.CharField(max_length=10, choices=Kind.choices)
    title = models.CharField(max_length=120)
    status = models.CharField(
        max_length=12,
        choices=Status.choices,
        default=Status.PENDING,
    )

    class Meta:
        indexes = [
            models.Index(fields=['building', 'status']),
        ]

    def __str__(self):
        return self.title


class ClaimMessage(UUIDModel):
    claim = models.ForeignKey(
        Claim,
        on_delete=models.PROTECT,
        related_name='messages',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='+',
    )
    from_admin = models.BooleanField(default=False)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']


class Task(TimeStampedModel):
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name='tasks',
    )
    building = models.ForeignKey(
        Building,
        on_delete=models.PROTECT,
        related_name='tasks',
    )
    text = models.CharField(max_length=90)
    due_date = models.DateField(null=True, blank=True)
    done = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='+',
    )

    class Meta:
        indexes = [
            models.Index(fields=['organization', 'done']),
        ]

    def __str__(self):
        return self.text
