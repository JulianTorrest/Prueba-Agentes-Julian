# Prueba Agentes — Periferia IT Group

Aplicación unificada en TypeScript (Node 20+) con **tres agentes conversacionales** en un solo front con pestañas:

- **Proveedores** (reto-01): lee solicitudes de registro, cruza el repositorio maestro, llena formularios (XLSX/PDF/portal) y arma el paquete para firma.
- **Contratos** (reto-02): buzón único de contratos; extrae datos con confianza, detecta duplicados/actualizaciones, registra en el maestro simulado de SharePoint y genera alertas.
- **Órdenes de compra** (reto-03): lee el paquete de compra, valida contra maestros, construye el payload de la OC, genera la evidencia y crea la OC en SAP simulado.

## Estructura

```text
agent/prompt.md             # prompt reto-01
agent/prompt-contratos.md   # prompt reto-02
agent/prompt-oc.md          # prompt reto-03
src/agent.ts                # orquestador por rol + clasificador + ciclo del agente
src/architecture.ts         # modelo de arquitectura (7 dimensiones) + workflows mermaid
src/files.ts                # listado/preview de out/ + estadísticas por agente
src/llm_adapter.ts          # Mistral/Groq por HTTP
src/server.ts               # API Express + estáticos
src/tools/proveedor.ts      # tools reto-01
src/tools/contratos.ts      # tools reto-02
src/tools/oc.ts             # tools reto-03
src/sap/adapter.ts          # interfaz SapAdapter
src/sap/mock.ts             # SAP simulado sobre out/sap/
fixtures/reto-01..03/       # datos de entrada (solo lectura)
public/index.html           # front con 3 tabs + health + menús
demo.ts                     # verificación sin modelo de los 3 retos
test.ts                     # pruebas automatizadas por chat (LLM_OFFLINE=1)
```

## Front: qué se ve

- **Tabs** Proveedores / Contratos / Órdenes de compra — cada una con su sesión y su confirmación humana.
- **Health**: indicador verde/rojo con proveedor, modelo y uptime (sondea `/api/health` cada 15 s).
- **Archivos generados**: explorador de `out/` con previsualización inline (md/txt/json/csv) y descarga (pdf/xlsx).
- **Estadísticas**: tarjetas por agente con documentos generados (formularios, paquetes, contratos en maestro, OCs, bloqueos).
- **Workflow del agente**: pipeline Mermaid del rol activo.
- **Arquitectura**: 7 dimensiones (empresarial, negocios, procesos, datos, solución, integración, ciberseguridad) renderizadas en Mermaid.

## Variables de entorno

Crea `.env` a partir de `.env.example`:

```text
MISTRAL_API_KEY=...
GROQ_API_KEY=...
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-20b
PORT=3000
# LLM_OFFLINE=1   # opcional: desactiva el LLM (clasificador determinista + resumen por tools)
```

## Uso local

```bash
npm install
npm run dev      # http://localhost:3000
npm run demo     # verificación determinista de los 3 retos (sin LLM)
npm test         # pruebas automatizadas por chat (15 checks, LLM_OFFLINE=1)
npm run build    # compila a dist/
npm start        # node dist/src/server.js
```

## API

| Método | Ruta | Cuerpo |
|---|---|---|
| POST | `/api/chat` | `{ sessionId, role: "proveedor"\|"contratos"\|"oc", message }` |
| GET | `/api/sessions/:role/:id` | historial de la sesión |
| GET | `/api/health` | `{ ok, provider, model, llm_offline, roles, uptime_s }` |
| GET | `/api/architecture` | dimensiones de arquitectura + diagramas Mermaid |
| GET | `/api/workflow/:role` | workflow Mermaid del agente (`proveedor`\|`contratos`\|`oc`) |
| GET | `/api/files` | árbol de archivos generados en `out/` |
| GET | `/api/files/content?p=` | preview de texto de un archivo de `out/` |
| GET | `/api/stats` | estadísticas por agente y totales |
| GET | `/out/<ruta>` | descarga directa de artefactos (pdf, xlsx, …) |

## Despliegue en Render

1. Sube el repo a GitHub.
2. Render → **Web Service** → conecta el repo (usa el `Dockerfile`).
3. Variables de entorno en el panel de Render (sin comillas): `MISTRAL_API_KEY`, `GROQ_API_KEY`, `LLM_PROVIDER=groq`, `LLM_MODEL=openai/gpt-oss-20b`, `PORT=3000`.
4. Auto-deploy: cada push a `main` recompila y redeploya.
5. Sin claves: define `LLM_OFFLINE=1` en Render para la demo determinista.

**Link de prueba**: <https://prueba-agentes-julian.onrender.com>

Las sesiones son por rol y pestaña; cada tab mantiene su historial y su estado de confirmación humana. En Render el filesystem es efímero: `out/` se reinicia con cada deploy (normal para la demo).
