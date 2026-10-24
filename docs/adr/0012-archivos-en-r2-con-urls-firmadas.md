# ADR-0012: Archivos en R2 privado con URLs firmadas

- **Estado:** Aceptada
- **Fecha:** 2026-10-23

## Contexto
Los comprobantes son datos personales y financieros. Subirlos a través de Django consume memoria y ancho de banda del servidor.

## Decisión
El navegador sube y baja directo a R2 con URLs firmadas de 5 minutos. El nombre del objeto es un UUID. El backend verifica tipo (magic bytes), tamaño y sha256 antes de aceptar el comprobante. Bucket privado y con versionado en producción.

## Alternativas descartadas
- Subir a Django y guardar en disco: no escala y complica el deploy en Railway.

## Consecuencias
- Una tarea periódica limpia los objetos huérfanos (subidos pero nunca registrados).
