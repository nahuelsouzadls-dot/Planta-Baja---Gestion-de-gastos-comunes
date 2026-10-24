from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.core.exceptions import ValidationError


CENT = Decimal('0.01')


def to_money(value) -> Decimal:
    if isinstance(value, float):
        raise TypeError('Los montos deben ser Decimal, no float.')
    try:
        amount = value if isinstance(value, Decimal) else Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValidationError('El monto no es válido.') from error
    if not amount.is_finite():
        raise ValidationError('El monto no es válido.')
    quantized = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    if quantized != amount:
        raise ValidationError('Los montos tienen como máximo 2 decimales')
    return quantized
