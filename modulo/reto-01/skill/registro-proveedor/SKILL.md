---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor ante clientes de Periferia (fuentes de datos, reglas de negocio, artefactos de salida)
---

# Conocimiento del proceso — Registro como proveedor

## Entrada

- `fixtures/reto-01/casos/<caso>/solicitud.json` — correo normalizado del cliente: `pais`, `cliente`, `formato` (`xlsx`/`pdf`/`portal`), `campos`, `adjuntos`.
- `plantilla-celdas.json` (xlsx) o `plantilla-campos.json` (pdf) — qué campos llenar y dónde.
- `soportes-exigidos.json` — tipos de soporte que exige el cliente.

## Fuentes de verdad (solo lectura)

- `fixtures/reto-01/repositorio/maestro.json` — datos de Periferia (NIT, representante, banco, cuenta, CIIU…).
- `fixtures/reto-01/repositorio/soportes/index.json` — soportes con `vigencia_hasta` y `pais_emisor`.
- `fixtures/reto-01/glosario-campos.json` — sinónimos de etiquetas del cliente → clave del maestro.

## Reglas de negocio

- **RN1**: identificador tributario por país — CO→NIT, EC/PE/PA→RUC, HN→RTN. Países sin NIT colombiano se llenan con el NIT y se marcan `requiere_confirmacion` ("identificador extranjero").
- **RN2**: datos bancarios solo si la plantilla los pide; nunca en el borrador de correo.
- **RN3**: soporte vencido o exigido ausente bloquea `listo_para_firma`; campo `faltante` no bloquea.
- **RN4**: ninguna acción externa sin confirmación explícita en el turno anterior.
- **RN5**: cada ejecución registra en `out/<caso>/log.jsonl`.

## Salida

- `out/<caso>/formulario.xlsx|pdf` (o `valores-portal.md` si `formato=portal`).
- `out/<caso>/paquete/` — formulario + soportes + `checklist.md` + `borrador-correo.md`.
- `out/<caso>/ENVIO-SIMULADO.md` — solo tras confirmación humana.
