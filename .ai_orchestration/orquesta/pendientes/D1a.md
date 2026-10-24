# D1a — Subida de comprobantes a S3 (intento + verificación)

## O — Objetivo
El residente sube el comprobante directo al almacenamiento S3 (MinIO/R2) y el backend lo acepta solo si el archivo es del mismo usuario, existe y es lo que dice ser.

## A — Alcance
- Tocás: `backend/apps/storage/` (app nueva), `backend/apps/api/v1/portal.py` + sus tests, `backend/config/settings/` (S3), `backend/requirements/base.txt` (`boto3`), `development.txt` (`moto[s3]`), `backend/.env.example`.
- Leés: `docs/adr/0012-archivos-en-r2-con-urls-firmadas.md`, `docs/arquitectura/almacenamiento.md §4`, `apps/.../submit_receipt` (servicio existente).
- Fuera: ver el archivo, limpieza de huérfanos, MinIO real (eso es D1b).

## R — Restricciones
1. Subida con `generate_presigned_post`: `content-length-range` 1 B–10 MB, `Content-Type` y `key` exactos, vence en 5 min.
2. `UploadIntent`: `file_key` único, `user`, `occupancy`, `content_type`, `size_bytes`, `filename`, `expires_at`, `consumed_at`.
3. Key: `receipts/<organization_id>/<uuid4>`; el nombre original no va en la key.
4. Al enviar: intento del mismo usuario, vigente, sin consumir. Verificar `head_object` (tamaño = declarado), magic bytes por `Range` (JPEG `FFD8FF`, PNG `89504E470D0A1A0A`, PDF `%PDF-`, WebP `RIFF....WEBP`, HEIC `ftyp`+`heic|heix|mif1|msf1`) y sha256 leyendo en partes. Si falla: borrar objeto, consumir intento, 400.
5. Errores de `file_key` (ajeno/consumido/vencido/inexistente) → mismo 400 genérico.
6. Settings: `S3_ENDPOINT_URL` (interna) y `S3_PUBLIC_ENDPOINT_URL` (para firmar lo que va al navegador).
7. Siempre: tests primero con `moto`; lógica en `apps/storage/services.py`, no en vistas; sin git; montos como string.

## S — Salida
Endpoints:
- `POST /api/v1/portal/occupancies/{id}/receipts/upload` `{content_type,size_bytes,filename}` → `{file_key,url,fields}`.
- `POST /api/v1/portal/receipts` `{file_key,declared_amount,transfer_date,allocations:[{occupancy_id,amount}],note}` → `submit_receipt`.

Tests (moto):
1. Flujo completo → `Receipt` `pending`, `file_sha256` correcto, intento consumido.
2. Tipo no permitido / >10 MB / 0 B → 400 al pedir la URL.
3. PNG declarado con bytes de texto o `.exe` → 400 y objeto borrado.
4. Tamaño real ≠ declarado → 400.
5. `file_key` ajeno, consumido, vencido, inexistente → 400 y ningún `Receipt`.

Además: migración aplica en base nueva; `manage.py spectacular --validate` sin errores. Reporte con el formato del README.
