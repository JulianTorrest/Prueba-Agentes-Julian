# Prueba Agentes — Periferia IT Group

Aplicación unificada en TypeScript (Node 20+) con **tres agentes conversacionales** en un solo front con pestañas:

- **Proveedores** (reto-01): lee solicitudes de registro, cruza el repositorio maestro, llena formularios (XLSX/PDF/portal) y arma el paquete para firma.
- **Contratos** (reto-02): buzón único de contratos; extrae datos con confianza, detecta duplicados/actualizaciones, registra en el maestro simulado de SharePoint y genera alertas.
- **Órdenes de compra** (reto-03): lee el paquete de compra, valida contra maestros, construye el payload de la OC, genera la evidencia y crea la OC en SAP simulado.

## Estructura

```
agent/prompt.md             # prompt reto-01
agent/prompt-contratos.md   # prompt reto-02
agent/prompt-oc.md          # prompt reto-03
src/agent.ts                # orquestador por rol + ciclo del agente
src/llm_adapter.ts          # Mistral/Groq por HTTP
src/server.ts               # API Express + estáticos
src/tools/proveedor.ts      # tools reto-01
src/tools/contratos.ts      # tools reto-02
src/tools/oc.ts             # tools reto-03
src/sap/adapter.ts          # interfaz SapAdapter
src/sap/mock.ts             # SAP simulado sobre out/sap/
public/index.html           # front con 3 tabs
demo.ts                     # verificación sin modelo de los 3 retos
```

## Variables de entorno

Crea `.env` a partir de `.env.example`:

```
MISTRAL_API_KEY=...
GROQ_API_KEY=...
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-20b
PORT=3000
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
| GET | `/api/health` | `{ ok, provider, model, roles }` |

## Despliegue en Render

1. Sube el repo a GitHub.
2. Render → **Web Service** → conecta el repo (usa el `Dockerfile`).
3. Variables de entorno en el panel de Render: `MISTRAL_API_KEY`, `GROQ_API_KEY`, `LLM_PROVIDER=groq`, `LLM_MODEL=openai/gpt-oss-20b`, `PORT=3000`.
4. URL pública: `https://<app>.onrender.com`.

Las sesiones son por rol y pestaña; cada tab mantiene su historial y su estado de confirmación humana.

Las sesiones son por rol y pestaña; cada tab mantiene su historial y su estado de confirmación humana.
