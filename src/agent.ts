import * as path from "path";
import * as fs from "fs";
import * as llm from "./llm_adapter.js";
import * as proveedor from "./tools/proveedor.js";
import * as contratos from "./tools/contratos.js";
import * as oc from "./tools/oc.js";

type Role = "proveedor" | "contratos" | "oc";

const PROMPTS: Record<Role, string> = {
  proveedor: path.join(process.cwd(), "agent/prompt.md"),
  contratos: path.join(process.cwd(), "agent/prompt-contratos.md"),
  oc: path.join(process.cwd(), "agent/prompt-oc.md"),
};

const CASOS = ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"];

function prompt(role: Role) {
  return fs.readFileSync(PROMPTS[role], "utf-8");
}

function extractCase(text: string): string | null {
  const low = text.toLowerCase();
  for (const c of CASOS) if (low.includes(c)) return c;
  const m = text.match(/"([^"]+)"/);
  return m ? m[1].toLowerCase() : null;
}

function isCorrection(text: string): boolean {
  const low = text.toLowerCase();
  return /corregir|corrección|error|reprocesa|cambia el valor|no es correcto|usa este valor/.test(low);
}

function getProviderModel() {
  const provider = process.env.LLM_PROVIDER || "mistral";
  const defaultModels: Record<string, string> = {
    mistral: "open-mistral-nemo",
    groq: "openai/gpt-oss-20b",
  };
  return { provider, model: process.env.LLM_MODEL || defaultModels[provider] || "open-mistral-nemo" };
}

// Clasificador determinista: devuelve null cuando la intención es ambigua y se
// necesita el LLM. Con LLM_OFFLINE=1 es el único camino (modo test).
function classifyDeterministic(userMsg: string, session: any, role: Role): any | null {
  const low = userMsg.toLowerCase();
  const hasPending = Boolean(session.pending || session.pendingCase);
  // \b no funciona con tildes (í no es \w en JS): comparar tokens
  const tokens = low.split(/[\s,;.!¡¿?]+/).filter(Boolean);
  const hasConfirm = tokens.some((t) =>
    ["sí", "si", "confirmo", "confirma", "confirmar", "adelante", "procede", "apruebo"].includes(t)
  );
  if (hasPending && hasConfirm) {
    return {
      accion: role === "proveedor" ? "enviar" : "confirmar",
      confirmado: true,
      caso: session.pendingCase || session.pending?.caso,
      mensaje_id: session.pending?.mensaje_id,
    };
  }
  if (role === "proveedor") {
    const caso = extractCase(userMsg);
    if (isCorrection(userMsg)) return { accion: "corregir", caso: caso || session.pendingCase };
    if (/enviar|env[ií]a/.test(low) && (caso || hasPending))
      return { accion: "enviar", caso: caso || session.pendingCase, confirmado: hasConfirm };
    if (/(procesa|procesar|genera|generar|arma|armar|llena|llenar)/.test(low) && caso)
      return { accion: "procesar", caso };
    if (/(lista|muestra|mostrar|qu[eé] casos)/.test(low)) return { accion: "mostrar" };
    if (caso) return { accion: "procesar", caso };
    return null;
  }
  if (role === "contratos") {
    const mensaje_id = (userMsg.match(/msg-\d+/i) || [])[0];
    const hoy = (userMsg.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
    if (/(alertas|vencen|vencimientos|p[oó]lizas)/.test(low)) return { accion: "procesar", hoy };
    if (/(procesa|procesar|registra|registrar)/.test(low)) return { accion: "procesar", mensaje_id, hoy };
    if (/(buz[oó]n|lista|muestra|mostrar|pendientes)/.test(low)) return { accion: "mostrar" };
    if (mensaje_id) return { accion: "procesar", mensaje_id, hoy };
    return null;
  }
  // oc
  const caso = (userMsg.match(/sol-\d+/i) || [])[0];
  if (/(todas|todos)/.test(low) && /(procesa|procesar|crear|[óo]rdenes)/.test(low)) return { accion: "procesar" };
  if (/(procesa|procesar|crear|crea|valida|validar|revisa|revisar)/.test(low) && caso)
    return { accion: "procesar", caso };
  if (caso) return { accion: "procesar", caso };
  return null;
}

async function summarize(userMsg: string, toolLog: any[], role: Role): Promise<string> {
  if (process.env.LLM_OFFLINE === "1") {
    if (!toolLog.length) return "No ejecuté herramientas. Indica un caso, mensaje o solicitud para procesar.";
    const lines = toolLog.map(
      (t) =>
        `- ${t.herramienta}${t.caso || t.mensaje_id ? ` [${t.caso || t.mensaje_id}]` : ""}: ${
          t.ok ? "ok" : "error"
        } — ${String(typeof t.resumen === "string" ? t.resumen : JSON.stringify(t.resumen)).slice(0, 200)}`
    );
    return `Resultados de herramientas:\n${lines.join("\n")}`;
  }
  const { provider, model } = getProviderModel();
  const res = await llm.chat(
    [
      { role: "system", content: prompt(role) },
      {
        role: "user",
        content: `El usuario pidió: ${userMsg}\n\nResultados de herramientas:\n${JSON.stringify(toolLog).slice(0, 4000)}\n\nGenera una respuesta breve, profesional y concreta.`,
      },
    ],
    provider,
    model
  );
  return res.ok ? res.content : `Error LLM: ${res.error}. Resultados: ${JSON.stringify(toolLog).slice(0, 500)}`;
}

async function classify(userMsg: string, session: any, role: Role): Promise<any> {
  const det = classifyDeterministic(userMsg, session, role);
  if (det) return det;
  if (process.env.LLM_OFFLINE === "1") return { accion: "consultar" };
  const { provider, model } = getProviderModel();
  const schema =
    role === "proveedor"
      ? '{accion: procesar|mostrar|confirmar|corregir|consultar, caso?, confirmado?, instrucciones?}'
      : role === "contratos"
        ? '{accion: procesar|mostrar|confirmar|consultar, mensaje_id?, confirmado?, hoy?}'
        : '{accion: procesar|confirmar|consultar, caso?, confirmado?}';
  const res = await llm.chat(
    [
      { role: "system", content: "Eres un clasificador. Responde solo JSON válido con el esquema indicado." },
      {
        role: "user",
        content: `Mensaje: ${userMsg}\nContexto pendiente: ${JSON.stringify(session.pending || session.pendingCase || null)}\nEsquema: ${schema}`,
      },
    ],
    provider,
    model,
    true
  );
  if (!res.ok) return det || { accion: "consultar" };
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : det || { accion: "consultar" };
  } catch {
    return det || { accion: "consultar" };
  }
}

// ===========================================================================
// ROL: proveedor (reto-01)
// ===========================================================================
async function runProveedor(userMsg: string, session: any) {
  const toolLog: any[] = [];
  let pendingCase = session.pendingCase;
  let needsConfirmation = false;
  let reply = "";

  const intentData = await classify(userMsg, session, "proveedor");
  const casoFromMsg = extractCase(userMsg);
  const caso = intentData.caso || pendingCase || casoFromMsg;
  let accion = (intentData.accion || "consultar").toLowerCase();
  const confirmado = Boolean(intentData.confirmado);
  if (isCorrection(userMsg)) accion = "corregir";

  if (accion === "procesar" && caso) {
    const ctx = { directory: process.cwd(), sessionId: session.id };
    const r1 = await proveedor.leer_solicitud.execute({ caso }, ctx);
    const p1 = JSON.parse(r1);
    toolLog.push({ herramienta: "proveedor_leer_solicitud", ok: p1.ok, resumen: p1.data || p1.error });
    if (p1.ok) {
      const r2 = await proveedor.mapear_campos.execute({ caso, campos: p1.data.campos }, ctx);
      const p2 = JSON.parse(r2);
      toolLog.push({ herramienta: "proveedor_mapear_campos", ok: p2.ok, resumen: p2.data || p2.error });
      if (p2.ok) {
        const r3 = await proveedor.generar_formulario.execute({ caso, mapeo: p2.data }, ctx);
        const p3 = JSON.parse(r3);
        toolLog.push({ herramienta: "proveedor_generar_formulario", ok: p3.ok, resumen: p3.data || p3.error });
        const r4 = await proveedor.armar_paquete.execute({ caso }, ctx);
        const p4 = JSON.parse(r4);
        toolLog.push({ herramienta: "proveedor_armar_paquete", ok: p4.ok, resumen: p4.data || p4.error });
        reply = await summarize(userMsg, toolLog, "proveedor");
      } else reply = `No pude mapear campos para ${caso}: ${p2.error}`;
    } else reply = `No pude leer ${caso}: ${p1.error}`;
    pendingCase = caso;
  } else if (accion === "enviar") {
    const c = caso || pendingCase;
    if (!c) reply = "No hay un caso pendiente. Procesa uno primero.";
    else if (!confirmado) {
      reply = `Necesito confirmación explícita para enviar el caso '${c}'. Escribe 'sí, envía'.`;
      needsConfirmation = true;
      pendingCase = c;
    } else {
      const ctx = { directory: process.cwd(), sessionId: session.id };
      const r = await proveedor.simular_envio.execute({ caso: c, confirmado: true }, ctx);
      const p = JSON.parse(r);
      toolLog.push({ herramienta: "proveedor_simular_envio", ok: p.ok, resumen: p.data || p.error });
      reply = p.ok ? `Envío simulado para **${c}**: ${p.data.ruta}` : `No se pudo simular: ${p.error}`;
      needsConfirmation = false;
      pendingCase = null;
    }
  } else if (accion === "corregir") {
    const c = caso || pendingCase;
    const m = userMsg.match(/valor\s*[:=]?\s*\$?\s*([\d.,]+)/i);
    if (!c || !m) reply = "Dime el valor correcto, por ejemplo: 'valor: 12000000'.";
    else {
      const valor = parseInt(m[1].replace(/\./g, "").replace(",", ""));
      const ctx = { directory: process.cwd(), sessionId: session.id };
      const r = await proveedor.leer_solicitud.execute({ caso: c }, ctx);
      const p = JSON.parse(r);
      if (!p.ok) reply = `No pude releer ${c}: ${p.error}`;
      else {
        for (const cp of p.data.campos) {
          if (cp.clave === "valor_moneda" || cp.clave === "valor_estimado") cp.valor = valor;
        }
        const r2 = await proveedor.mapear_campos.execute({ caso: c, campos: p.data.campos }, ctx);
        const p2 = JSON.parse(r2);
        toolLog.push({ herramienta: "proveedor_mapear_campos", ok: p2.ok, resumen: p2.data || p2.error });
        if (p2.ok) {
          const r3 = await proveedor.generar_formulario.execute({ caso: c, mapeo: p2.data }, ctx);
          const p3 = JSON.parse(r3);
          toolLog.push({ herramienta: "proveedor_generar_formulario", ok: p3.ok, resumen: p3.data || p3.error });
          const r4 = await proveedor.armar_paquete.execute({ caso: c }, ctx);
          const p4 = JSON.parse(r4);
          toolLog.push({ herramienta: "proveedor_armar_paquete", ok: p4.ok, resumen: p4.data || p4.error });
          reply = `Corregido valor a ${valor}. Vuelve a pedir el paquete si quieres regenerar.`;
        } else reply = `No pude reprocesar ${c}: ${p2.error}`;
      }
    }
  } else {
    reply = await summarize(userMsg, toolLog, "proveedor");
  }
  return { reply, toolCalls: toolLog, needsConfirmation, pending: { pendingCase } };
}

// ===========================================================================
// ROL: contratos (reto-02)
// ===========================================================================
async function runContratoMsg(mensaje_id: string, toolLog: any[], ctx: any, session: any) {
  const r1 = contratos.extraer.execute({ mensaje_id }, ctx);
  const p1 = JSON.parse(r1);
  toolLog.push({ herramienta: "contratos_extraer", mensaje_id, ok: p1.ok, resumen: p1.data?.contrato?.id_contrato?.valor || p1.error });
  if (!p1.ok) return `No pude extraer ${mensaje_id}: ${p1.error}`;
  const contrato = p1.data.contrato;

  const r2 = contratos.validar.execute({ mensaje_id, contrato }, ctx);
  const p2 = JSON.parse(r2);
  toolLog.push({ herramienta: "contratos_validar", mensaje_id, ok: p2.ok, resumen: p2.data });
  if (!p2.ok) return `No pude validar ${mensaje_id}: ${p2.error}`;

  const { clasificacion, requiere_revision } = p2.data;
  if (clasificacion === "rechazado" || clasificacion === "duplicado") {
    const r3 = contratos.registrar.execute({ mensaje_id, contrato, clasificacion }, ctx);
    const p3 = JSON.parse(r3);
    toolLog.push({ herramienta: "contratos_registrar", mensaje_id, ok: p3.ok, resumen: p3.data || p3.error });
    return `${mensaje_id}: ${clasificacion}.`;
  }
  if (requiere_revision.length > 0) {
    session.pending = { role: "contratos", mensaje_id, contrato, clasificacion };
    return `${mensaje_id}: ${clasificacion} pendiente de revisión (${requiere_revision.join(", ")}).`;
  }
  const r3 = contratos.registrar.execute({ mensaje_id, contrato, clasificacion }, ctx);
  const p3 = JSON.parse(r3);
  toolLog.push({ herramienta: "contratos_registrar", mensaje_id, ok: p3.ok, resumen: p3.data || p3.error });
  return p3.ok ? `${mensaje_id}: ${clasificacion} registrado (${p3.data.id_contrato}).` : `${mensaje_id}: error ${p3.error}`;
}

async function runContratos(userMsg: string, session: any) {
  const toolLog: any[] = [];
  let needsConfirmation = false;
  let reply = "";
  const ctx = { directory: process.cwd(), sessionId: session.id };
  const intentData = await classify(userMsg, session, "contratos");
  const accion = (intentData.accion || "consultar").toLowerCase();
  const mensaje_id = intentData.mensaje_id || (userMsg.match(/msg-\d+/) || [])[0];
  const confirmado = Boolean(intentData.confirmado);
  const hoy = intentData.hoy || (userMsg.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || "2026-09-03";

  if (accion === "consultar") {
    reply = await summarize(userMsg, toolLog, "contratos");
  } else if (accion === "mostrar" || accion === "procesar" && !mensaje_id) {
    if (accion === "mostrar") {
      const r = contratos.leer_buzon.execute({}, ctx);
      const p = JSON.parse(r);
      toolLog.push({ herramienta: "contratos_leer_buzon", ok: p.ok, resumen: p.data });
      reply = await summarize(userMsg, toolLog, "contratos");
    } else {
      const r0 = contratos.leer_buzon.execute({}, ctx);
      const p0 = JSON.parse(r0);
      toolLog.push({ herramienta: "contratos_leer_buzon", ok: p0.ok, resumen: `${(p0.data?.mensajes || []).length} mensajes` });
      const resultados: string[] = [];
      for (const m of p0.data?.mensajes || []) {
        const res = await runContratoMsg(m.id, toolLog, ctx, session);
        resultados.push(res);
        if (res.includes("pendiente de revisión")) needsConfirmation = true;
      }
      const rA = contratos.alertas.execute({ hoy }, ctx);
      const pA = JSON.parse(rA);
      toolLog.push({ herramienta: "contratos_alertas", ok: pA.ok, resumen: pA.data });
      reply = await summarize(userMsg, toolLog, "contratos");
      reply += `\n\n**Resultados:**\n${resultados.join("\n")}`;
      if (needsConfirmation) reply += `\n\n¿Confirmo el registro de los pendientes?`;
    }
  } else if (accion === "procesar" && mensaje_id) {
    const res = await runContratoMsg(mensaje_id, toolLog, ctx, session);
    reply = await summarize(userMsg, toolLog, "contratos");
    reply += `\n\n${res}`;
    if (res.includes("pendiente de revisión")) {
      needsConfirmation = true;
      reply += `\n\n¿Confirmo el registro?`;
    }
  } else if (accion === "confirmar" || confirmado) {
    if (session.pending?.role === "contratos") {
      const { mensaje_id: pid, contrato, clasificacion } = session.pending;
      const r = contratos.registrar.execute({ mensaje_id: pid, contrato, clasificacion, confirmado: true }, ctx);
      const p = JSON.parse(r);
      toolLog.push({ herramienta: "contratos_registrar", mensaje_id: pid, ok: p.ok, resumen: p.data || p.error });
      reply = p.ok ? `Registrado ${pid} como ${clasificacion}: ${p.data.id_contrato}.` : `No se pudo registrar ${pid}: ${p.error}`;
      session.pending = null;
    } else {
      reply = "No hay registro pendiente de confirmación.";
    }
  }
  return { reply, toolCalls: toolLog, needsConfirmation, pending: session.pending };
}

// ===========================================================================
// ROL: oc (reto-03)
// ===========================================================================
async function runOcCaso(caso: string, toolLog: any[], ctx: any, session: any, confirmado: boolean) {
  const r1 = oc.leer_paquete.execute({ caso }, ctx);
  const p1 = JSON.parse(r1);
  toolLog.push({ herramienta: "oc_leer_paquete", caso, ok: p1.ok, resumen: p1.data?.paquete?.solicitud?.solicitud_id || p1.error });
  if (!p1.ok) return `No pude leer ${caso}: ${p1.error}`;
  const paquete = p1.data.paquete;

  const r2 = await oc.validar.execute({ caso, paquete }, ctx);
  const p2 = JSON.parse(r2);
  toolLog.push({ herramienta: "oc_validar", caso, ok: p2.ok, resumen: p2.data });
  if (!p2.ok) return `No pude validar ${caso}: ${p2.error}`;
  const validacion = p2.data;

  if (!validacion.apta) {
    await oc.crear.execute({ caso, validacion, confirmado }, ctx);
    return `${caso}: bloqueada (${validacion.bloqueos.join("; ")}).`;
  }
  if (validacion.confirmaciones.length > 0 && !confirmado) {
    session.pending = { role: "oc", caso, paquete, validacion };
    return `${caso}: requiere confirmación (${validacion.confirmaciones.join("; ")}).`;
  }
  const r3 = await oc.construir_payload.execute({ caso, paquete, derivados: validacion.derivados }, ctx);
  const p3 = JSON.parse(r3);
  toolLog.push({ herramienta: "oc_construir_payload", caso, ok: p3.ok, resumen: p3.data?.ruta_trazabilidad || p3.error });
  if (!p3.ok) return `No pude construir payload para ${caso}: ${p3.error}`;

  const r4 = await oc.generar_evidencia.execute({ caso }, ctx);
  const p4 = JSON.parse(r4);
  toolLog.push({ herramienta: "oc_generar_evidencia", caso, ok: p4.ok, resumen: p4.data?.sha256 || p4.error });

  const r5 = await oc.crear.execute({ caso, payload: p3.data.payload, validacion, confirmado }, ctx);
  const p5 = JSON.parse(r5);
  toolLog.push({ herramienta: "oc_crear", caso, ok: p5.ok, resumen: p5.data || p5.error });
  return p5.ok
    ? `${caso}: OC ${p5.data.numero_oc} creada${p5.data.idempotente ? " (idempotente)" : ""}${validacion.retroactiva ? " — retroactiva" : ""}.`
    : `${caso}: ${p5.error}`;
}

async function runOc(userMsg: string, session: any) {
  const toolLog: any[] = [];
  let needsConfirmation = false;
  let reply = "";
  const ctx = { directory: process.cwd(), sessionId: session.id };
  const intentData = await classify(userMsg, session, "oc");
  const accion = (intentData.accion || "consultar").toLowerCase();
  const caso = intentData.caso || (userMsg.match(/sol-\d+/) || [])[0];
  const confirmado = Boolean(intentData.confirmado);

  if (accion === "consultar") {
    reply = await summarize(userMsg, toolLog, "oc");
  } else if (accion === "procesar" && caso) {
    const res = await runOcCaso(caso, toolLog, ctx, session, confirmado);
    reply = await summarize(userMsg, toolLog, "oc");
    reply += `\n\n${res}`;
    if (res.includes("requiere confirmación")) needsConfirmation = true;
  } else if (accion === "procesar" && !caso) {
    const resultados: string[] = [];
    for (const c of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
      const res = await runOcCaso(c, toolLog, ctx, session, false);
      resultados.push(res);
      if (res.includes("requiere confirmación")) needsConfirmation = true;
    }
    reply = await summarize(userMsg, toolLog, "oc");
    reply += `\n\n**Resultados:**\n${resultados.join("\n")}`;
  } else if (accion === "confirmar" || confirmado) {
    if (session.pending?.role === "oc") {
      const res = await runOcCaso(session.pending.caso, toolLog, ctx, session, true);
      reply = res;
      session.pending = null;
    } else {
      reply = "No hay orden pendiente de confirmación.";
    }
  }
  return { reply, toolCalls: toolLog, needsConfirmation, pending: session.pending };
}

// ===========================================================================
// Orquestador
// ===========================================================================
export async function processMessage(userMsg: string, session: any, role: Role = "proveedor") {
  let out: any;
  if (role === "contratos") out = await runContratos(userMsg, session);
  else if (role === "oc") out = await runOc(userMsg, session);
  else out = await runProveedor(userMsg, session);

  session.messages.push({ role: "user", content: userMsg });
  session.messages.push({ role: "assistant", content: out.reply });
  session.pendingCase = out.pending?.pendingCase ?? session.pendingCase;
  session.pending = out.pending ?? session.pending;
  return { reply: out.reply, toolCalls: out.toolCalls, needsConfirmation: out.needsConfirmation };
}
