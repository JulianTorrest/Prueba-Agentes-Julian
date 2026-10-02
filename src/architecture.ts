// Modelo de arquitectura de la solución, servido por /api/architecture y
// renderizado en el front como Mermaid. Cada dimensión incluye resumen y diagrama.

export const ARCHITECTURE = {
  nombre: "Agentes Periferia — Retos 1 · 2 · 3",
  orquestador: {
    tipo: "Dispatcher por rol (determinista)",
    detalle:
      "El usuario elige el rol en la pestaña del front. POST /api/chat recibe { role } y src/agent.ts enruta al pipeline del rol (prompt + tools + fixtures + out propios). El LLM NO decide el rol.",
  },
  llm_switch: {
    variable: "LLM_PROVIDER",
    opciones: ["groq", "mistral"],
    modelo_default: "openai/gpt-oss-20b (groq) · open-mistral-nemo (mistral)",
    modo_offline: "LLM_OFFLINE=1 desactiva el LLM para pruebas deterministas",
  },
  dimensiones: [
    {
      id: "empresarial",
      nombre: "Empresarial",
      resumen:
        "Periferia IT Group automatiza tres backlogs administrativos: registro de proveedores, maestro de contratos y órdenes de compra SAP. El valor es tiempo de la analista, auditoría continua y un único punto de recepción por dominio.",
      mermaid: `flowchart LR
  A["Objetivo: cero digitación manual"] --> B["reto-01 Registro de proveedores"]
  A --> C["reto-02 Maestro de contratos"]
  A --> D["reto-03 Órdenes de compra SAP"]
  B --> E["Ahorro horas analista"]
  C --> F["Auditoría y alertas de vencimiento"]
  D --> G["OCs idempotentes y trazables"]`,
    },
    {
      id: "negocios",
      nombre: "Negocios",
      resumen:
        "Dominios de negocio cubiertos: compras, administración y finanzas, legal/garantías y gerencia comercial. Reglas de negocio clave: dedupe por id/NIT, confianza por campo con revisión humana, controles RC1–RC10 de OC, OC retroactiva medible.",
      mermaid: `flowchart LR
  subgraph Dominios
    C["Compras"] --> CC["OC SAP, proveedores"]
    F["Administración/Finanzas"] --> FF["Paquetes de firma, facturas"]
    L["Legal"] --> LL["Contratos, pólizas"]
    G["Gerencia comercial"] --> GG["Gobierno del buzón, métricas"]
  end`,
    },
    {
      id: "procesos",
      nombre: "Procesos",
      resumen:
        "Cada rol ejecuta un pipeline fijo: entrada → extracción → validación → acción → evidencia. Las excepciones no bloquean el sistema; se marcan para confirmación humana y quedan en el log.",
      mermaid: `flowchart TB
  subgraph Proveedores
    P1["leer solicitud"] --> P2["mapear campos"] --> P3["generar formulario"] --> P4["armar paquete"] --> P5["confirmar envío"]
  end
  subgraph Contratos
    C1["leer buzón"] --> C2["extraer"] --> C3["validar/clasificar"] --> C4["registrar/archivar"] --> C5["alertas"]
  end
  subgraph Órdenes
    O1["leer paquete"] --> O2["validar RC1-RC10"] --> O3["payload"] --> O4["evidencia"] --> O5["crear OC"]
  end`,
    },
    {
      id: "datos",
      nombre: "Datos",
      resumen:
        "Los fixtures son de solo lectura. Todo lo escrito va a out/: maestro simulado, historial, logs, control de OCs. El agente nunca inventa un valor: cada dato proviene de una tool.",
      mermaid: `flowchart LR
  subgraph Entrada-lectura
    F1["fixtures/reto-01"]
    F2["fixtures/reto-02 buzón + maestro CSV"]
    F3["fixtures/reto-03 solicitudes + maestros"]
  end
  subgraph Salida-escritura
    O1["out/<caso>/ formularios y paquetes"]
    O2["out/sharepoint/ maestro + historial"]
    O3["out/sap/ ordenes + control.csv"]
    O4["out/log.jsonl auditoría"]
  end
  F1 --> O1
  F2 --> O2
  F3 --> O3`,
    },
    {
      id: "solucion",
      nombre: "Solución",
      resumen:
        "Front estático con 3 tabs → Express /api/chat {role} → src/agent.ts (orquestador por rol) → classify (determinista, luego LLM) → tools zod → summarize (LLM) → respuesta. Sesiones por rol:sessionId.",
      mermaid: `flowchart LR
  U["Usuario"] --> T["Front 3 tabs"]
  T --> API["POST /api/chat {role}"]
  API --> AG["src/agent.ts orquestador"]
  AG --> LLM["llm_adapter groq|mistral"]
  AG --> TL["tools/proveedor contratos oc"]
  TL --> FX["fixtures"]
  TL --> SP["sap/mock"]
  TL --> OT["out/"]
  AG --> T`,
    },
    {
      id: "integracion",
      nombre: "Integración",
      resumen:
        "Puntos de integración: LLM por HTTP directo (Groq/Mistral con switch por env), SAP simulado con interfaz SapAdapter (diseñado para OData API_PURCHASEORDER_PROCESS_SRV), SharePoint simulado sobre out/sharepoint. Idempotencia por referencia de solicitud.",
      mermaid: `flowchart LR
  APP["App Express"] --> G["Groq / Mistral (LLM_PROVIDER)"]
  APP --> SAP["SapAdapter"]
  SAP --> MOCK["mock: out/sap/ordenes.jsonl"]
  SAP -.producción.-> O["OData API_PURCHASEORDER_PROCESS_SRV"]
  APP --> SH["SharePoint simulado out/sharepoint"]`,
    },
    {
      id: "ciberseguridad",
      nombre: "Ciberseguridad",
      resumen:
        "Claves API solo por variables de entorno (nunca en prompt ni logs). Tools zod validan argumentos y tipan el acceso a disco. Confirmación humana para todo lo sensible (envío, registro con revisión, OC con confirmaciones). Auditoría en out/log.jsonl con sha256 de evidencias.",
      mermaid: `flowchart TB
  S["Controles"] --> A["API keys en .env / vault"]
  S --> B["Zod valida entrada de tools"]
  S --> C["Confirmación humana obligatoria"]
  S --> D["out/log.jsonl + sha256 evidencias"]
  S --> E["fixtures de solo lectura"]`,
    },
  ],
};

export const WORKFLOWS: Record<string, { nombre: string; mermaid: string }> = {
  proveedor: {
    nombre: "Workflow — Registro de proveedores (reto-01)",
    mermaid: `flowchart TD
  U["Usuario: procesa el caso X"] --> C{"classify"}
  C -->|procesar| L["proveedor_leer_solicitud"]
  L --> M["proveedor_mapear_campos"]
  M --> G["proveedor_generar_formulario"]
  G --> A["proveedor_armar_paquete"]
  A --> R["summarize + respuesta"]
  U2["envía"] --> CF{"confirmado?"}
  CF -->|sí| E["proveedor_simular_envio"]
  CF -->|no| Q["pregunta explícita"]
  U3["corrige valor"] --> J["remapear + regenerar"]`,
  },
  contratos: {
    nombre: "Workflow — Contratos (reto-02)",
    mermaid: `flowchart TD
  U["procesa el buzón / msg-00X"] --> B["contratos_leer_buzon"]
  B --> E["contratos_extraer"]
  E --> V["contratos_validar"]
  V --> D{"clasificación"}
  D -->|nuevo| R["contratos_registrar"]
  D -->|actualizacion| R
  D -->|duplicado| X["solo marca procesado"]
  D -->|rechazado| X
  V -->|requiere_revision| H["confirmación humana"] --> R
  R --> AL["contratos_alertas → out/alertas.md"]`,
  },
  oc: {
    nombre: "Workflow — Órdenes de compra SAP (reto-03)",
    mermaid: `flowchart TD
  U["procesa sol-00X"] --> L["oc_leer_paquete"]
  L --> V["oc_validar RC1-RC10"]
  V --> D{"¿apta?"}
  D -->|bloqueos| B["oc_crear → bloqueada en control.csv"]
  D -->|confirmaciones| H["confirmación humana"]
  D -->|ok| P["oc_construir_payload"]
  H --> P
  P --> EV["oc_generar_evidencia"]
  EV --> CR["oc_crear → SAP mock"]
  CR --> CC["control.csv · numero_oc · retroactiva"]`,
  },
};
