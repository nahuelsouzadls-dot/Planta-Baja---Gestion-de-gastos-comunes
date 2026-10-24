import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Func
from django.db.models.functions import Now


class RowChange(models.Model):
    class Operation(models.TextChoices):
        INSERT = 'INSERT', 'INSERT'
        UPDATE = 'UPDATE', 'UPDATE'
        DELETE = 'DELETE', 'DELETE'

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        db_default=Func(function='gen_random_uuid'),
        editable=False,
    )
    table_name = models.CharField(max_length=63)
    row_id = models.UUIDField()
    operation = models.CharField(max_length=6, choices=Operation.choices)
    old_values = models.JSONField(null=True)
    new_values = models.JSONField(null=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='+',
    )
    organization_id = models.UUIDField(null=True, blank=True)
    db_user = models.CharField(max_length=63)
    request_ip = models.CharField(max_length=45, blank=True)
    request_path = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table_name', 'row_id'], name='audit_rowchange_table_row_idx'),
            models.Index(fields=['actor', 'created_at'], name='audit_rowchange_actor_date_idx'),
            models.Index(fields=['created_at'], name='audit_rowchange_created_idx'),
        ]

    def save(self, *args, **kwargs):
        raise ValidationError('RowChange solo puede ser escrito por el trigger de auditoría.')

    def delete(self, *args, **kwargs):
        raise ValidationError('RowChange es append-only y no se puede borrar.')

    def __str__(self):
        return f'{self.table_name} {self.operation} {self.row_id}'
