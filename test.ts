// Pruebas automatizadas de cada chat. Ejecuta el pipeline completo del
// orquestador (classify → tools → respuesta) en modo offline determinista:
// LLM_OFFLINE=1 evita llamar a Groq/Mistral, así que es reproducible sin claves.
process.env.LLM_OFFLINE = "1";

import * as fs from "fs";
import * as path from "path";
import { processMessage } from "./src/agent.js";
import { leer_pdf } from "./src/tools/contratos.js";
import { leer_excel } from "./src/tools/oc.js";
import * as XLSX from "xlsx";

const OUT = path.join(process.cwd(), "out");
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;

function check(nombre: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  ✔", nombre, extra); }
  else { fail++; console.log("  ✘", nombre, extra); }
}

function newSession(id: string, role: string) {
  return { id: `${role}:${id}`, role, messages: [] as any[], pendingCase: null, pending: null };
}

function hasTool(r: any, name: string, okOnly = true) {
  return (r.toolCalls || []).some((t: any) => t.herramienta === name && (!okOnly || t.ok));
}

console.log("=== Pruebas automatizadas por chat (LLM_OFFLINE=1) ===\n");

// ------------------------------------------------------------------ reto-01
console.log("Chat Proveedores");
{
  const s = newSession("t1", "proveedor");
  let r = await processMessage("Procesa el caso co-industrias-delta", s, "proveedor");
  check("procesar ejecuta leer_solicitud", hasTool(r, "proveedor_leer_solicitud"));
  check("procesar ejecuta el pipeline completo", hasTool(r, "proveedor_armar_paquete"));
  check("respuesta no vacía", (r.reply || "").length > 0);

  r = await processMessage("Envía el paquete", s, "proveedor");
  check("enviar pide confirmación humana", r.needsConfirmation === true);

  r = await processMessage("Sí, envía", s, "proveedor");
  check("enviar confirmado ejecuta simular_envio", hasTool(r, "proveedor_simular_envio"));
}

// ------------------------------------------------------------------ reto-02
console.log("\nChat Contratos");
{
  const s = newSession("t2", "contratos");
  let r = await processMessage("Muestra el buzón", s, "contratos");
  check("buzón listado", hasTool(r, "contratos_leer_buzon"));

  r = await processMessage("Procesa msg-001", s, "contratos");
  check("msg-001 registrado", hasTool(r, "contratos_registrar"));
  check("respuesta menciona el contrato", /CT-2026-015/.test(r.reply || ""));

  r = await processMessage("Procesa msg-004", s, "contratos");
  check("msg-004 detectado duplicado", /duplicado/i.test(r.reply || ""));

  r = await processMessage("Procesa msg-006", s, "contratos");
  check("msg-006 pide revisión humana", r.needsConfirmation === true || /revisión/i.test(r.reply || ""));

  r = await processMessage("Sí, confirma", s, "contratos");
  check("msg-006 registrado tras confirmar", hasTool(r, "contratos_registrar"));
}

// ------------------------------------------------------------------ reto-03
console.log("\nChat Órdenes de compra");
{
  const s = newSession("t3", "oc");
  let r = await processMessage("Procesa la solicitud sol-001", s, "oc");
  check("sol-001 OC creada", hasTool(r, "oc_crear") && /45\d{8}/.test(r.reply || ""));

  r = await processMessage("Procesa la solicitud sol-003", s, "oc");
  check(
    "sol-003 bloqueada por aprobador",
    (r.toolCalls || []).some((t: any) => t.herramienta === "oc_validar" && t.resumen?.apta === false)
  );

  r = await processMessage("Procesa la solicitud sol-005", s, "oc");
  check("sol-005 pide confirmación (retroactiva)", /confirmación|retroactiva/i.test(r.reply || ""));

  r = await processMessage("Sí, confirmo", s, "oc");
  check("sol-005 OC creada tras confirmar", hasTool(r, "oc_crear"));
}

// ----------------------------------------------------- tools P1 opcionales
console.log("\nTools P1 (PDF / Excel)");
{
  const ctx = { directory: process.cwd(), sessionId: "p1" };

  // PDF generado con pdf-lib sin object streams (compatibles con pdf-parse 1.x)
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText("CONTRATO-TEST-123", { font: await doc.embedFont(StandardFonts.Helvetica) });
  fs.writeFileSync(path.join(OUT, "_p1.pdf"), await doc.save({ useObjectStreams: false }));
  const pdf = JSON.parse(await leer_pdf.execute({ ruta: "out/_p1.pdf" }, ctx));
  check("contratos_leer_pdf extrae texto", pdf.ok === true && /CONTRATO-TEST-123/.test(pdf.data?.texto || ""));

  // xlsx generado con la misma librería que usa la tool (write → buffer, fs independiente)
  const XLSXc: any = (XLSX as any).default ?? XLSX;
  const ws = XLSXc.utils.aoa_to_sheet([["solicitud_id", "valor_total"], ["SOL-TEST", 123]]);
  const wb = XLSXc.utils.book_new();
  XLSXc.utils.book_append_sheet(wb, ws, "Hoja1");
  fs.writeFileSync(path.join(OUT, "_p1.xlsx"), XLSXc.write(wb, { type: "buffer", bookType: "xlsx" }));
  const x = JSON.parse(await leer_excel.execute({ ruta: "out/_p1.xlsx" }, ctx));
  check("oc_leer_excel devuelve filas", x.ok === true && x.data?.filas?.[0]?.solicitud_id === "SOL-TEST");

  const bad = JSON.parse(await leer_pdf.execute({ ruta: "../fuera.pdf" }, ctx));
  check("leer_pdf rechaza ruta fuera del proyecto", bad.ok === false);
}

console.log(`\n=== Resultado: ${pass} pasaron · ${fail} fallaron ===`);
process.exit(fail ? 1 : 0);
