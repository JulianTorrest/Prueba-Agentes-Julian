---
name: registro-contratos
description: Conocimiento del proceso del buzón único de contratos (extracción con confianza, clasificación RN1-RN4, registro y alertas)
---

# Conocimiento del proceso — Registro de contratos vigentes

## Entrada

- `fixtures/reto-02/buzon/<msg-XXX>/correo.json` — correo del comercial con `adjuntos`.
- `fixtures/reto-02/buzon/<msg-XXX>/contrato.txt|otrosi.txt` — texto del documento.
- `fixtures/reto-02/maestro-contratos.csv` — maestro congelado al 2026-05-30 (solo lectura; se copia a `out/sharepoint/`).
- `fixtures/reto-02/comerciales.json` — remitentes reconocidos.

## Clasificación (reglas RN1–RN4)

- **Duplicado**: mismo `id_contrato` y mismos `valor`/`fecha_inicio`/`fecha_fin` → no escribe.
- **Actualización**: mismo `id_contrato` (o `nit_cliente` + objeto similar) con cambios, o documento otrosí → actualiza la fila y registra en `historial.jsonl`.
- **Nuevo**: sin coincidencia → inserta; si `requiere_poliza` → `estado_poliza = pendiente`.
- **Rechazado**: sin adjunto de contrato o sin partes/objeto identificables.

## Confianza y revisión

- Extracción determinista (regex sobre el texto) con `confianza` por campo en `[0,1]`.
- Campo ausente → `null` con confianza `0`, nunca inventado.
- `confianza < 0.8` → `requiere_revision`; `contratos_registrar` exige `confirmado = true`.
- En otrosíes solo se revisan los campos que el documento modifica.

## Salida

- `out/sharepoint/maestro-contratos.csv` + `out/sharepoint/Contratos/<año>/<cliente-slug>/<id>.txt`.
- `out/sharepoint/historial.jsonl` — `{ ts, id_contrato, accion, cambios, mensaje_id }`.
- `out/procesados.json` — mensajes ya procesados (idempotencia del buzón).
- `out/alertas.md` — vencen ≤ 60 días, pólizas pendientes, registrados desde el corte.
