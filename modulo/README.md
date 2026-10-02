# modulo/ — agentes empaquetados (bonus §9.4)

Cada subcarpeta empaqueta un agente para integrarse a otras plataformas sin depender del servidor:

```text
modulo/
├── reto-01/
│   ├── agent.md                          # system prompt (idéntico a agent/prompt.md)
│   ├── tools/proveedor.ts                # re-export de src/tools/proveedor.ts
│   └── skill/registro-proveedor/SKILL.md # conocimiento del proceso
├── reto-02/
│   ├── agent.md                          # idéntico a agent/prompt-contratos.md
│   ├── tools/contratos.ts                # re-export de src/tools/contratos.ts
│   └── skill/registro-contratos/SKILL.md
└── reto-03/
    ├── agent.md                          # idéntico a agent/prompt-oc.md
    ├── tools/oc.ts                       # re-export de src/tools/oc.ts
    └── skill/ordenes-compra/SKILL.md
```

**Misma pieza, no copia**: `agent.md` contiene verbatim el system prompt de `agent/`, y `tools/*.ts` re-exporta los módulos de `src/tools/` — así el módulo y la app nunca divergen. Las herramientas son importables sin el servidor:

```ts
import { leer_paquete } from "./modulo/reto-03/tools/oc.js";
const res = await leer_paquete.execute({ caso: "sol-001" }, { directory: process.cwd(), sessionId: "x" });
```

`agent.md` usa el frontmatter estándar (`mode: primary`, `permission: {edit: deny, bash: deny}`) compatible con plataformas de agentes tipo opencode.
