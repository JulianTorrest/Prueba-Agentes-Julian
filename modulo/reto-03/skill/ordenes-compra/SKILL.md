---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra SAP (paquete de entrada, controles RC1-RC10, payload, evidencia e idempotencia)
---

# Conocimiento del proceso — Órdenes de compra SAP

## Entrada

- `fixtures/reto-03/solicitudes/<sol-XXX>/` — `correo.json`, `solicitud.json`, `cotizacion.txt`, `aprobacion.json`, opcional `factura.txt`.
- `fixtures/reto-03/maestros/` — `proveedores.json`, `centros-costo.json`, `indicadores-iva.json`, `condiciones-pago.json`.

## Controles RC1–RC10

- **Bloqueos** (impiden la OC): RC1 proveedor inexistente/inactivo; RC2 aprobación ausente, sin "Aprobado" o de correo no aprobador del centro; RC3 `valor_total` > tope del aprobador; RC4 `subarea` fuera del centro; RC10 `cantidad × valor_unitario ≠ valor_total` (±1).
- **Confirmaciones** (requieren `confirmado`): RC5 cotización difiere > 2 % o ausente; RC6 IVA no informado (se deriva `indicador_iva_default`); RC8 factura anterior a la solicitud → `retroactiva`; RC9 aprobación anterior a la solicitud.
- **Derivados** (solo se informan): RC7 `condiciones_pago` del proveedor.

## Salida

- `out/<caso>/trazabilidad.json` — cada valor del payload con su fuente.
- `out/<caso>/aprobacion.txt|pdf` — evidencia con `sha256`.
- `out/sap/ordenes.jsonl` — OC creada; número secuencial desde `4500000001`.
- `out/control.csv` — `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`.

## Idempotencia

`buscarOrdenPorReferencia(solicitud_id)` antes de crear: si ya existe OC para la solicitud, devuelve el número existente sin duplicar. La implementación real diseñada usa OData `API_PURCHASEORDER_PROCESS_SRV`.
