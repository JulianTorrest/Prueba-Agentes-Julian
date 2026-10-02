# SOLUCION.md — Retos 1 · 2 · 3 · Periferia IT Group

## 1. Problema en una frase

Periferia tiene tres procesos administrativos manuales que dependen de correos dispersos y memoria de una analista: el registro de proveedores (reto-01), el maestro de contratos congelado (reto-02) y la digitación de órdenes de compra en SAP (reto-03). Duele a administración, gerencia y auditoría.

## 2. Arquitectura

Una sola aplicación Express + front estático con **tres pestañas** (una por rol). `POST /api/chat` recibe `{ sessionId, role, message }` y el orquestador (`src/agent.ts`) despacha al agente del rol: cada rol tiene su `prompt`, sus herramientas `zod` en `src/tools/` y sus fixtures. El orquestador es determinista: no decide el rol por IA, lo elige el usuario.

```
Front (3 tabs) → POST /api/chat {role} → src/agent.ts
              → classify()  [LLM → JSON de intención]
              → tools/*     [zod, deterministas, única fuente de valores]
              → summarize() [LLM → respuesta legible]
fixtures/** solo lectura · out/** escritura (forms, paquetes, sharepoint, sap, logs)
```

- **Comportamiento**: `agent/prompt.md`, `agent/prompt-contratos.md`, `agent/prompt-oc.md`.
- **Ejecución**: `src/tools/proveedor.ts`, `src/tools/contratos.ts`, `src/tools/oc.ts`, `src/sap/mock.ts`.
- **Modelo**: `src/llm_adapter.ts` con `fetch` directo a Mistral y Groq; cambiar de proveedor no toca el ciclo.

## 3. Ciclo del agente

1. `classify` pide al LLM un JSON pequeño: `accion`, `caso`/`mensaje_id`, `confirmado`. Es la única vez que el modelo interpreta la intención.
2. Un pipeline determinista ejecuta las herramientas del rol en orden (el modelo nunca afirma un valor no producido por una herramienta).
3. Si la acción requiere confirmación humana, el turno termina con una pregunta explícita y el front la resalta; el siguiente mensaje con `confirmado: true` reintenta.
4. `summarize` convierte los resultados a lenguaje claro.
5. Toda llamada queda en el historial de sesión y en `out/log.jsonl`.

Tope de iteraciones: el pipeline es fijo por turno (máx. ~5 llamadas por mensaje), por debajo del tope sugerido de 25.

## 4. Elección del modelo

- **Proveedor**: Groq por defecto (`LLM_PROVIDER`), con Mistral como alternativa.
- **Modelo**: `openai/gpt-oss-20b` (Groq). Las llamadas de clasificación son JSON cortos; el resumen trunca el log a 4000 caracteres.
- **Costo estimado**: ~2 llamadas LLM por mensaje (clasificación + resumen), ~800 tokens cada una → centavos por turno en capas gratuitas. `demo.ts` no consume tokens.

## 5. Reto-01 · Proveedores

Herramientas `proveedor_*`: `leer_solicitud`, `mapear_campos` (glosario + maestro), `generar_formulario` (XLSX/PDF/portal con `xlsx`/`pdf-lib`), `armar_paquete` (checklist de soportes con vigencias), `simular_envio` (exige `confirmado`). Campos con confianza baja (identificador extranjero mapeado desde NIT) se marcan y piden confirmación.

### Diseño del portal web (reto-01 §7.4)

- **Estrategia**: navegador controlado por el agente (Playwright) con un `portal_adapter.ts` análogo a `sap/adapter.ts` — el agente prepara los valores, abre el formulario y deja el envío al humano. Límites: CAPTCHA/MFA y cambios de layout se resuelven por el humano; el agente detecta el bloqueo y termina con `valores-portal.md`.
- **Credenciales**: en un gestor de secretos/`.env` del entorno de la analista, nunca en el repo, el prompt ni los logs. El login lo hace el humano; el agente opera sobre la sesión abierta.
- **División humano/agente**: el agente llena campos y adjunta soportes; el humano ingresa credenciales, resuelve CAPTCHA/MFA y hace el clic en "Enviar". Todo queda en `out/<caso>/log.jsonl`.

## 6. Reto-02 · Contratos

### Matriz de reglas implementada

| Regla | Implementación |
|---|---|
| RN1 duplicado | mismo `id_contrato` + mismo `valor`/`fecha_inicio`/`fecha_fin` → no escribe |
| RN2 actualización | mismo `id_contrato` o documento `otrosí` → actualiza fila y `historial.jsonl` |
| RN3 nuevo | sin coincidencia → inserta |
| RN4 rechazado | sin adjunto `contrato.txt`/`otrosi.txt` → no procesa |
| RN5 confianza < 0.8 | `requiere_revision`; `registrar` sin `confirmado` devuelve error legible |
| RN6 fixture solo lectura | primera ejecución copia a `out/sharepoint/maestro-contratos.csv` |
| RN7 log | `out/log.jsonl` con `{ts, herramienta, mensaje_id, ok, resumen}` |

Extracción determinista: regex sobre `contrato.txt`/`otrosi.txt` para número, partes, NIT/RUC, valor, moneda, plazo (fechas en español), pólizas y remitente contra `comerciales.json`. Confianza por campo en `[0,1]`; ausentes quedan `null` con confianza 0. En otrosíes solo se revisan los campos modificados.

Resultados de la demo: `msg-001`/`msg-002` nuevos registrados, `msg-003` actualización (plazo y valor de CT-2026-011), `msg-004` duplicado sin escritura, `msg-005` rechazado (cotización, no contrato), `msg-006` pendiente de revisión (`valor`, `fecha_fin` — contrato marco por demanda) y `alertas.md` con vencen/pólizas/gap.

### Regla de gobierno (propuesta obligatoria)

1. **Canal único**: `contratos@periferia-ficticia.com` administrado por la analista administrativa; el agente lee el buzón cada mañana.
2. **Obligación del comercial**: enviar el PDF firmado de todo contrato (con o sin póliza), otrosíes y actas de terminación, máximo 5 días hábiles tras la firma, con asunto `CONTRATO <número> - <cliente>`.
3. **Acuse automático**: el agente responde en minutos con clasificación y datos extraídos; si algo falta, indica qué pedir.
4. **Excepciones**: contrato sin firma o sin valor → se marca `requiere_revision`, se notifica al comercial y se escala a gerencia comercial si no responde en 5 días.
5. **Cierre del gap**: campaña única en septiembre 2026 — gerencia envía correo a cada comercial pidiendo todos los contratos de junio–agosto; el buzón los absorbe y `registrados_desde_corte` mide el avance.
6. **Indicador**: % de contratos facturados del mes que existen en el maestro (objetivo 100 %).

## 7. Reto-03 · Órdenes de compra

### Matriz de controles RC1–RC10

| # | Control | Tipo | Implementación |
|---|---|---|---|
| RC1 | Proveedor existe y activo | Bloqueo | `proveedores.json` por NIT o nombre normalizado |
| RC2 | Aprobación válida y de aprobador del centro | Bloqueo | `aprobacion.json` contiene "Aprobado" + `de` ∈ `centro_costo.aprobadores` |
| RC3 | valor_total ≤ tope del aprobador | Bloqueo | comparación directa |
| RC4 | subarea ∈ centro_costo | Bloqueo | pertenencia |
| RC5 | cotización ≈ solicitud (±2 %) | Confirmación | diferencia relativa |
| RC6 | IVA ausente → derivar del proveedor | Confirmación + derivado | `indicador_iva_default` |
| RC7 | condiciones de pago ausentes → derivar | Derivado | `condiciones_pago_default` |
| RC8 | factura < solicitud → retroactiva | Confirmación | `retroactiva = true` en `control.csv` |
| RC9 | aprobación ≥ fecha_solicitud | Confirmación | comparación de fechas |
| RC10 | cantidad × valor_unitario = valor_total | Bloqueo | tolerancia ±1 |

El más difícil: RC2+RC3 combinadas (la aprobación debe venir de quien tiene autoridad sobre ese centro y monto — `sol-003` falla las dos cosas).

### Diseño del adaptador SAP real (obligatorio)

- **Opción elegida**: OData `API_PURCHASEORDER_PROCESS_SRV` (API hub estándar de S/4HANA). Razón: REST/JSON, idempotencia con claves externas, fácil de probar con un mock. Descartado RFC/BAPI (requiere librerías nativas y acceso de red) y carga por archivo (pierde idempotencia y evidencia).
- **Mapeo**: `payload.proveedor.codigo_sap` → `Supplier`; `posiciones` → `to_PurchaseOrderItem` (`MaterialDocumentItemText`, `OrderQuantity`, `NetPriceAmount`, `CostCenter`, `TaxCode`); `condiciones_pago` → `PaymentTerms`; `referencia.solicitud_id` → `PurchasingGroup`-like external reference para idempotencia.
- **Autenticación**: credenciales de servicio en un vault (no en `.env` del agente, nunca en el prompt ni en logs). El agente solo llama al adaptador; el adaptador firma.
- **Idempotencia**: `buscarOrdenPorReferencia(solicitud_id)` antes de crear; si existe, se devuelve el número existente sin duplicar (demo lo verifica con `sol-001` × 2). Ante error parcial de SAP, se deja el caso en `pendiente` con la respuesta cruda en `out/<caso>/error.json` y se reintenta sin crear la referencia.
- **Plan B**: si la conexión a SAP no es viable, el agente igual ahorra el 80 % del tiempo generando `oc_payload.json` listo para copiar/pegar o un CSV de carga masiva por archivo, manteniendo `control.csv` como auditoría.

### Lectura del proceso (hallazgo retroactivo)

Las OC retroactivas (`sol-005`) no son un error del agente: son un desvío del proceso real — la factura ya llegó antes de que exista la solicitud. El agente las tolera pero las marca `retroactiva = true` en `control.csv`, así dirección puede medir el porcentaje y exigir que el solicitante acople la fecha de la cotización o rechace la compra post-factura.

## 8. Decisiones y trade-offs

1. **Pipeline determinista vs. herramientas-of-choice**: el LLM solo clasifica y resume; las herramientas son la única fuente de verdad. Descarté dejar que el modelo decida qué herramienta llamar en cadena, porque un modelo puede "arreglar" montos o saltarse controles.
2. **Confianza por campo vs. bloqueo total**: reto-02 devuelve `requiere_revision` en vez de rechazar contratos incompletos — un contrato marco sin valor no es un error, es una pregunta para humano.
3. **Un orquestador por rol vs. tres apps**: comparten `server.ts`, `llm_adapter` y el front; el rol es explícito (tab), no inferido, porque mezclar buzones distintos en una sesión confundiría la confirmación humana.
4. **JSON/CSV simulados vs. DB**: los PRD piden archivos en `out/`; una DB real se diseña en la sección 7 (adaptador SAP) sin implementarla.

## 9. Supuestos

- Contratos llegan como `contrato.txt`/`otrosi.txt` con texto (sin OCR); en producción se añade OCR P1.
- Los maestros de reto-03 son completos y vigentes; en producción se consultan en SAP en tiempo real.
- El correo de aprobación es evidencia suficiente (auditoría podría exigir firma digital).
- El buzón de reto-02 solo procesa no-`procesados.json`; el maestro fixture nunca se modifica.

## 10. Cobertura

| HU | Reto-01 | Reto-02 | Reto-03 |
|---|---|---|---|
| Leer entrada | ✅ leer_solicitud | ✅ leer_buzon | ✅ leer_paquete |
| Extraer/validar | ✅ mapear_campos | ✅ extraer + validar | ✅ validar RC1–RC10 |
| Construir/registrar | ✅ generar_formulario + armar_paquete | ✅ registrar | ✅ construir_payload + crear |
| Confirmación humana | ✅ simular_envio | ✅ requiere_revision | ✅ confirmaciones |
| Alertas/control | — | ✅ alertas | ✅ control.csv + retroactiva |
| Demo sin LLM | ✅ | ✅ | ✅ |

Falta para producción: OCR/real PDF, autenticación, base de datos, colas, y adaptadores reales a SharePoint/SAP.

## 11. Uso de IA

- **Cascade (SWE-1.6)**: portar la lógica Python → TypeScript, diseñar el orquestador por rol, escribir los regex de extracción de contratos y la matriz RC1–RC10, depurar `tsconfig`, generar documentación.
- **Mistral/Groq** (en runtime): clasificación de intención y resumen de resultados; nunca decisiones de negocio.
- Descartado: SDKs oficiales de Groq/Mistral (bug de `proxies`) → fetch directo; orquestador "inteligente" que adivina el rol → dispatcher explícito por tab.

## 12. Riesgos de producción

| Riesgo | Mitigación |
|---|---|
| Falsos duplicados de contratos | dedupe por `nit_cliente` antes que por nombre |
## 13. Observabilidad y verificación (añadido)

- **Health**: `|ET /api/health` devuelv  `{ ok, provider, model, llm_offline, roles, uptime_s }`; el froEt lo mulst m como inoicaddrevlrde/rojo en eo header.
- **Arquitectura en vivo**: `GET /api/architecture` sirve 7 dimensiones (empresarial, negocios, procesos, datos, solución, integración, ciberseguridad) con diagramas Mermaid que el front renderiza; `GET /api/workflow/:role` devuelve el pipeline del agente.
- **Salidas**: `GET /api/files` + `GET /api/files/content` + `GET /api/stats` exponen los artefactos de `out/` con preview/descarga y estadísticas por agente.
- **Pruebas**: `npm test` ejecuta 15 checks de preguntas reales por chat con `LLM_OFFLINE=1` (clasificador determinista, sin claves).

---
Generado el infiere montos | el valor registrado sale` (sin clave), `npm test de la herramienta, no del modelo; humano confirma |
| SAP no integrable | adaptador OData diseñado + Plan B de payload para carga manual |
| Contratos escaneados | OCR en P1; hoy se confía en el texto entregado |
| Bucles del agente | pipeline fijo, tope de iteraciones, tope de tokens configurable |

---
Generado el 2026-10-01. Verificable con `npm run demo` (sin clave) y `npm run dev` (chat con 3 tabs).
