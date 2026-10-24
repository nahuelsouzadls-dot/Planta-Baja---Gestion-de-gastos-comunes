"""Archivos en S3/R2 privado con URLs firmadas de 5 minutos (ADR-0012, almacenamiento.md §4).

El navegador sube y baja directo al almacenamiento; el backend firma, verifica y registra.
"""
import hashlib
import re
import uuid
from datetime import timedelta

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit.context import audit_context
from apps.storage.models import UploadIntent

URL_TTL = timedelta(minutes=5)
# La URL de subida vence a los 5 minutos; una subida lenta que empezó a tiempo tiene este
# margen extra para terminar y registrarse. Después, el intento es huérfano.
SUBMIT_GRACE = timedelta(minutes=10)
MAX_SIZE = 10 * 1024 * 1024
ALLOWED_TYPES = ('image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf')
HEIC_BRANDS = (b'heic', b'heix', b'mif1', b'msf1')
CHUNK = 1024 * 1024
# El mismo mensaje para un file_key ajeno, usado, vencido o inexistente: no se revela cuál.
INVALID_UPLOAD = 'El comprobante no es válido o venció. Subilo de nuevo.'


def _client(public=False):
    endpoint = settings.S3_PUBLIC_ENDPOINT_URL if public else settings.S3_ENDPOINT_URL
    return boto3.client(
        's3',
        endpoint_url=endpoint or None,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or None,
        region_name=settings.S3_REGION,
        config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}),
    )


def matches_type(head: bytes, content_type: str) -> bool:
    """Magic bytes: el contenido tiene que ser lo que dice el Content-Type."""
    if content_type == 'image/jpeg':
        return head.startswith(b'\xff\xd8\xff')
    if content_type == 'image/png':
        return head.startswith(b'\x89PNG\r\n\x1a\n')
    if content_type == 'application/pdf':
        return head.startswith(b'%PDF-')
    if content_type == 'image/webp':
        return head[:4] == b'RIFF' and head[8:12] == b'WEBP'
    if content_type == 'image/heic':
        return head[4:8] == b'ftyp' and head[8:12] in HEIC_BRANDS
    return False


def _clean_filename(filename):
    name = re.sub(r'[^\w.\- ]', '_', str(filename or ''))[:120]
    return name.strip() or 'comprobante'


@transaction.atomic
def create_upload_intent(user, occupancy, *, content_type, size_bytes, filename):
    if content_type not in ALLOWED_TYPES:
        raise ValidationError('El archivo tiene que ser una foto (JPG, PNG, HEIC o WebP) o un PDF.')
    if isinstance(size_bytes, bool) or not isinstance(size_bytes, int) or not 1 <= size_bytes <= MAX_SIZE:
        raise ValidationError('El archivo tiene que pesar entre 1 byte y 10 MB.')
    organization = occupancy.unit.building.organization
    key = f'receipts/{organization.pk}/{uuid.uuid4()}'
    with audit_context(user, organization=organization):
        intent = UploadIntent.objects.create(
            file_key=key,
            user=user,
            occupancy=occupancy,
            content_type=content_type,
            size_bytes=size_bytes,
            filename=_clean_filename(filename),
            expires_at=timezone.now() + URL_TTL,
        )
    # Política exacta: esa key, ese Content-Type y un tamaño máximo de 10 MB.
    post = _client(public=True).generate_presigned_post(
        settings.S3_BUCKET,
        key,
        Fields={'Content-Type': content_type},
        Conditions=[
            {'Content-Type': content_type},
            ['content-length-range', 1, MAX_SIZE],
        ],
        ExpiresIn=int(URL_TTL.total_seconds()),
    )
    return intent, post


def delete(key):
    try:
        _client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError:
        pass


def _consume(intent):
    with audit_context(intent.user, organization=intent.occupancy.unit.building.organization):
        intent.consumed_at = timezone.now()
        intent.save(update_fields=['consumed_at', 'updated_at'])


def verify_upload(user, file_key):
    """Toma el intento del usuario y verifica el objeto subido. Devuelve (intent, sha256).

    Si el archivo no es lo declarado, se borra y el intento queda consumido.
    """
    if not isinstance(file_key, str):
        raise ValidationError(INVALID_UPLOAD)
    with transaction.atomic():
        intent = (
            UploadIntent.objects.select_for_update()
            .select_related('occupancy__unit__building__organization', 'occupancy__person')
            .filter(
                file_key=file_key,
                user=user,
                consumed_at__isnull=True,
                expires_at__gt=timezone.now() - SUBMIT_GRACE,
            )
            .first()
        )
        if intent is None:
            raise ValidationError(INVALID_UPLOAD)
        client = _client()
        try:
            head = client.head_object(Bucket=settings.S3_BUCKET, Key=file_key)
        except ClientError as error:
            raise ValidationError(INVALID_UPLOAD) from error
        problem = None
        if head['ContentLength'] != intent.size_bytes:
            problem = 'El archivo no coincide con lo que se declaró. Subilo de nuevo.'
        else:
            first = client.get_object(
                Bucket=settings.S3_BUCKET, Key=file_key, Range='bytes=0-31'
            )['Body'].read()
            if not matches_type(first, intent.content_type):
                problem = 'El archivo no es una foto ni un PDF válido.'
        if problem:
            delete(file_key)
            # El intento queda consumido: se confirma al salir del bloque y después se avisa.
            _consume(intent)
        else:
            digest = hashlib.sha256()
            body = client.get_object(Bucket=settings.S3_BUCKET, Key=file_key)['Body']
            for chunk in iter(lambda: body.read(CHUNK), b''):
                digest.update(chunk)
            return intent, digest.hexdigest()
    raise ValidationError(problem)


def mark_consumed(intent):
    _consume(intent)


def signed_url(file_key, *, content_type=None, filename=None):
    params = {
        'Bucket': settings.S3_BUCKET,
        'Key': file_key,
        'ResponseContentDisposition': 'inline' + (f'; filename="{_clean_filename(filename)}"' if filename else ''),
    }
    if content_type:
        params['ResponseContentType'] = content_type
    return _client(public=True).generate_presigned_url(
        'get_object', Params=params, ExpiresIn=int(URL_TTL.total_seconds())
    )


def exists(file_key):
    try:
        _client().head_object(Bucket=settings.S3_BUCKET, Key=file_key)
    except ClientError:
        return False
    return True


def put_bytes(file_key, data, content_type):
    _client().put_object(
        Bucket=settings.S3_BUCKET, Key=file_key, Body=data, ContentType=content_type
    )


def cleanup_orphan_uploads(now=None):
    """Borra los objetos de intentos vencidos y nunca usados. Devuelve cuántos limpió."""
    now = now or timezone.now()
    stale = UploadIntent.objects.filter(
        consumed_at__isnull=True, expires_at__lt=now - SUBMIT_GRACE
    ).select_related('occupancy__unit__building__organization', 'user')
    count = 0
    for intent in stale:
        delete(intent.file_key)
        _consume(intent)
        count += 1
    return count
