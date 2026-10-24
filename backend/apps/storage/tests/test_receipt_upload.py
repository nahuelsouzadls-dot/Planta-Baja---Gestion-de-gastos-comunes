"""D1: subida directa al almacenamiento, verificación y vista del comprobante (con moto)."""
import hashlib
from datetime import timedelta

import boto3
import pytest
from django.conf import settings
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from moto import mock_aws

from apps.accounts.models import User
from apps.api.testing import api_client_for
from apps.ledger.models import Receipt
from apps.people.models import Occupancy
from apps.storage.models import UploadIntent
from apps.storage.services import INVALID_UPLOAD, cleanup_orphan_uploads
from tests.factories import OrgMembershipFactory


pytestmark = pytest.mark.django_db

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 64
JUAN = 'juan.perez@correo.com.uy'
MARIA_GARCIA = 'maria.garcia@correo.com.uy'


@pytest.fixture
def s3():
    with override_settings(
        S3_ENDPOINT_URL='', S3_PUBLIC_ENDPOINT_URL='', S3_ACCESS_KEY_ID='test',
        S3_SECRET_ACCESS_KEY='test', S3_BUCKET='comprobantes-test',
    ), mock_aws():
        client = boto3.client('s3', region_name=settings.S3_REGION)
        client.create_bucket(Bucket='comprobantes-test')
        yield client


@pytest.fixture
def demo(monkeypatch, s3):
    monkeypatch.setenv('DEMO_PASSWORD', 'demo-password-123')
    with override_settings(DEBUG=True):
        call_command('seed_demo')


def juan_occupancy():
    return Occupancy.objects.get(unit__building__name='Edificio Minas', unit__number='101', role='owner')


def request_upload(client, occupancy, *, content_type='image/png', size=len(PNG), filename='transferencia.png'):
    return client.post(
        f'/api/v1/portal/occupancies/{occupancy.pk}/receipts/upload',
        {'content_type': content_type, 'size_bytes': size, 'filename': filename},
        format='json',
    )


def submit(client, file_key, amount='4153.80'):
    return client.post(
        '/api/v1/portal/receipts',
        {'file_key': file_key, 'declared_amount': amount, 'transfer_date': '2026-10-20'},
        format='json',
    )


def upload_and_submit(s3, client, data=PNG):
    response = request_upload(client, juan_occupancy(), size=len(data))
    assert response.status_code == 201
    key = response.json()['file_key']
    s3.put_object(Bucket='comprobantes-test', Key=key, Body=data, ContentType='image/png')
    return key, submit(client, key)


def test_full_flow_registers_pending_receipt_with_hash(demo, s3):
    client = api_client_for(User.objects.get(email=JUAN))
    response = request_upload(client, juan_occupancy())
    body = response.json()

    assert response.status_code == 201
    assert body['file_key'].startswith(f'receipts/{juan_occupancy().unit.building.organization_id}/')
    assert 'transferencia' not in body['file_key']
    assert body['fields']['Content-Type'] == 'image/png'
    assert body['fields']['key'] == body['file_key']

    s3.put_object(Bucket='comprobantes-test', Key=body['file_key'], Body=PNG, ContentType='image/png')
    created = submit(client, body['file_key'])

    assert created.status_code == 201, created.json()
    receipt = Receipt.objects.get(pk=created.json()['id'])
    assert receipt.status == Receipt.Status.PENDING
    assert receipt.file_sha256 == hashlib.sha256(PNG).hexdigest()
    assert str(receipt.declared_amount) == '4153.80'
    assert UploadIntent.objects.get(file_key=body['file_key']).consumed_at is not None
    account = client.get(f'/api/v1/portal/occupancies/{juan_occupancy().pk}/account').json()
    assert account['status'] == 'revision'


@pytest.mark.parametrize('content_type, size', [
    ('text/plain', 10),
    ('application/x-msdownload', 10),
    ('image/png', 10 * 1024 * 1024 + 1),
    ('image/png', 0),
])
def test_upload_url_rejects_type_and_size(demo, content_type, size):
    client = api_client_for(User.objects.get(email=JUAN))
    response = request_upload(client, juan_occupancy(), content_type=content_type, size=size)

    assert response.status_code == 400
    assert not UploadIntent.objects.exists()


@pytest.mark.parametrize('data', [b'esto no es una imagen, es texto' * 3, b'MZ\x90\x00' + b'\x00' * 60])
def test_content_that_is_not_what_was_declared_is_deleted(demo, s3, data):
    client = api_client_for(User.objects.get(email=JUAN))
    key, response = upload_and_submit(s3, client, data)

    assert response.status_code == 400
    assert not Receipt.objects.filter(file_key=key).exists()
    assert s3.list_objects_v2(Bucket='comprobantes-test').get('KeyCount') == 0
    assert UploadIntent.objects.get(file_key=key).consumed_at is not None


def test_real_size_must_match_declared(demo, s3):
    client = api_client_for(User.objects.get(email=JUAN))
    response = request_upload(client, juan_occupancy(), size=len(PNG))
    key = response.json()['file_key']
    s3.put_object(Bucket='comprobantes-test', Key=key, Body=PNG + b'extra', ContentType='image/png')

    assert submit(client, key).status_code == 400
    assert not Receipt.objects.filter(file_key=key).exists()


def test_foreign_used_expired_or_missing_keys_get_the_same_error(demo, s3):
    juan = api_client_for(User.objects.get(email=JUAN))
    other = api_client_for(User.objects.get(email=MARIA_GARCIA))
    before = Receipt.objects.count()

    used, first = upload_and_submit(s3, juan)
    assert first.status_code == 201
    receipts_after_first = Receipt.objects.count()

    foreign = request_upload(juan, juan_occupancy()).json()['file_key']
    s3.put_object(Bucket='comprobantes-test', Key=foreign, Body=PNG)

    expired = request_upload(juan, juan_occupancy()).json()['file_key']
    s3.put_object(Bucket='comprobantes-test', Key=expired, Body=PNG)
    UploadIntent.objects.filter(file_key=expired).update(expires_at=timezone.now() - timedelta(hours=1))

    cases = [
        (other, foreign),
        (juan, used),
        (juan, expired),
        (juan, 'receipts/no-existe'),
        (juan, 12345),
    ]
    for client, key in cases:
        response = submit(client, key)
        assert response.status_code == 400
        assert response.json()['detail'] == INVALID_UPLOAD
    assert Receipt.objects.count() == receipts_after_first == before + 1


def test_receipt_file_is_visible_to_owner_and_staff_only(demo, s3):
    juan = api_client_for(User.objects.get(email=JUAN))
    key, created = upload_and_submit(s3, juan)
    receipt_id = created.json()['id']

    own = juan.get(f'/api/v1/portal/receipts/{receipt_id}/file')
    assert own.status_code == 200
    assert 'X-Amz-Expires=300' in own.json()['url']
    assert own.json()['content_type'] == 'image/png'

    other = api_client_for(User.objects.get(email=MARIA_GARCIA))
    assert other.get(f'/api/v1/portal/receipts/{receipt_id}/file').status_code == 404

    staff = api_client_for(User.objects.get(email='maria@confort.demo'))
    assert staff.get(f'/api/v1/receipts/{receipt_id}/file').status_code == 200
    outsider = api_client_for(OrgMembershipFactory().user)
    assert outsider.get(f'/api/v1/receipts/{receipt_id}/file').status_code == 404


def test_missing_object_answers_404(demo, s3):
    # Los comprobantes de la demo no tienen archivo en el almacenamiento.
    staff = api_client_for(User.objects.get(email='maria@confort.demo'))
    receipt = Receipt.objects.filter(status=Receipt.Status.PENDING).first()

    assert staff.get(f'/api/v1/receipts/{receipt.pk}/file').status_code == 404


def test_cleanup_only_removes_expired_unconsumed_uploads(demo, s3):
    juan = api_client_for(User.objects.get(email=JUAN))
    used, _ = upload_and_submit(s3, juan)
    fresh = request_upload(juan, juan_occupancy()).json()['file_key']
    stale = request_upload(juan, juan_occupancy()).json()['file_key']
    for key in (fresh, stale):
        s3.put_object(Bucket='comprobantes-test', Key=key, Body=PNG)
    UploadIntent.objects.filter(file_key=stale).update(expires_at=timezone.now() - timedelta(hours=1))

    assert cleanup_orphan_uploads() == 1

    keys = {item['Key'] for item in s3.list_objects_v2(Bucket='comprobantes-test')['Contents']}
    assert keys == {used, fresh}
    assert UploadIntent.objects.get(file_key=stale).consumed_at is not None
    assert UploadIntent.objects.get(file_key=fresh).consumed_at is None
