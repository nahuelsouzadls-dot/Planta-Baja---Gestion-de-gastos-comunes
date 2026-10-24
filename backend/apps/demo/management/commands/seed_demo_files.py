"""Sube un archivo de ejemplo para cada comprobante de la demo que no tiene archivo.

Va aparte de seed_demo para que los tests de la demo no dependan del almacenamiento.
Solo para desarrollo: los archivos dicen "EJEMPLO" y no son comprobantes reales.
"""
from io import BytesIO

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from PIL import Image, ImageDraw, ImageFont
from weasyprint import HTML

from apps.core.money import format_money
from apps.ledger.models import Receipt
from apps.storage import services as storage

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def _lines(receipt):
    return [
        'EJEMPLO · Transferencia realizada',
        f'Monto: {format_money(receipt.declared_amount)}',
        f'Fecha: {receipt.transfer_date:%d/%m/%Y}',
        f'Origen: {receipt.person}',
        'Destino: Confort S.A.',
    ]


def _image(receipt, fmt):
    image = Image.new('RGB', (720, 420), 'white')
    draw = ImageDraw.Draw(image)
    try:
        title, body = ImageFont.truetype(FONT, 30), ImageFont.truetype(FONT, 24)
    except OSError:
        title = body = ImageFont.load_default()
    draw.rectangle((0, 0, 720, 70), fill='#1f3a4d')
    draw.text((28, 18), 'Banco (ejemplo)', fill='white', font=title)
    for index, line in enumerate(_lines(receipt)):
        draw.text((28, 100 + index * 56), line, fill='#111', font=body)
    buffer = BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def _pdf(receipt):
    rows = ''.join(f'<p style="font-size:14pt">{line}</p>' for line in _lines(receipt))
    return HTML(string=f'<body style="font-family:DejaVu Sans">{rows}</body>').write_pdf()


class Command(BaseCommand):
    help = 'Sube archivos de ejemplo para los comprobantes de la demo (solo desarrollo).'

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('Solo se usa en desarrollo (DEBUG=True).')
        created = 0
        for receipt in Receipt.objects.select_related('person'):
            if storage.exists(receipt.file_key):
                continue
            if receipt.content_type == 'application/pdf':
                data = _pdf(receipt)
            else:
                data = _image(receipt, 'PNG' if receipt.content_type == 'image/png' else 'JPEG')
            storage.put_bytes(receipt.file_key, data, receipt.content_type)
            created += 1
        self.stdout.write(f'Archivos de ejemplo subidos: {created}')
