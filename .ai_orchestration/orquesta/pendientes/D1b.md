# D1b — Ver comprobantes y limpieza de huérfanos

## O — Objetivo
Empleados y residentes ven el archivo de un comprobante con una URL firmada corta, y los objetos subidos y nunca usados se borran.

## A — Alcance
- Tocás: `backend/apps/storage/`, `backend/apps/api/v1/panel.py`, `portal.py`, `permissions.py` + sus tests, `docker-compose.yml` (solo env S3 de `web`), `backend/pytest.ini`/`pyproject` (marcador), `.github/workflows/ci.yml` (solo `-m "not minio"`).
- Requiere D1a hecha. Leés: `apps/storage/` de D1a.
- Fuera: Celery (D2).

## R — Restricciones
1. URL GET firmada con `S3_PUBLIC_ENDPOINT_URL`, 5 min, `Content-Disposition: inline`.
2. Alcance: empleado de la organización del comprobante o el propio residente; el resto → 404.
3. `cleanup_orphan_uploads`: borra objeto + marca solo intentos vencidos y no consumidos.
4. Test contra MinIO real marcado `@pytest.mark.minio`, excluido en CI con `-m "not minio"` (no skip).
5. Siempre: tests primero con `moto`; sin git.

## S — Salida
- `GET /api/v1/receipts/{id}/file` (empleado) y `GET /api/v1/portal/receipts/{id}/file` (residente) → `{url}`.
- Tests: aislamiento (otra org / otro residente → 404; dueño y empleado → 200 con vencimiento 5 min); cleanup borra solo lo vencido sin consumir.
- `docker compose up -d minio minio-init && pytest -m minio -q | tail -3` en el reporte.
- Una línea recomendando reemplazo mantenido de las imágenes MinIO de Rancher (SeaweedFS/Garage/otra), sin cambiarlo.
