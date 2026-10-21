from datetime import date
from decimal import Decimal

import pytest

from apps.ledger.models import Movement


@pytest.mark.django_db
class TestMovementModel:
    def test_create_movement_append(self, owner_resident):
        movement = Movement.objects.create(
            resident=owner_resident,
            date=date(2026, 10, 1),
            movement_type=Movement.MovementType.CHARGE,
            amount=Decimal('-1500.00'),
        )
        assert movement.pk is not None
        assert Movement.objects.filter(pk=movement.pk).exists()

    def test_update_movement_raises_value_error(self, owner_resident):
        movement = Movement.objects.create(
            resident=owner_resident,
            date=date(2026, 10, 1),
            movement_type=Movement.MovementType.CHARGE,
            amount=Decimal('-1500.00'),
        )
        movement.notes = 'intento de modificación'
        with pytest.raises(ValueError, match='inmutables'):
            movement.save()

    def test_amount_can_be_negative(self, owner_resident):
        movement = Movement.objects.create(
            resident=owner_resident,
            date=date(2026, 10, 1),
            movement_type=Movement.MovementType.CHARGE,
            amount=Decimal('-800.00'),
        )
        assert movement.amount < 0

    def test_amount_can_be_positive(self, owner_resident):
        movement = Movement.objects.create(
            resident=owner_resident,
            date=date(2026, 10, 5),
            movement_type=Movement.MovementType.PAYMENT,
            amount=Decimal('800.00'),
            payment_status=Movement.PaymentStatus.COMPLETED,
        )
        assert movement.amount > 0

    def test_no_updated_at_field(self):
        field_names = [f.name for f in Movement._meta.get_fields()]
        assert 'updated_at' not in field_names
        assert 'created_at' in field_names
