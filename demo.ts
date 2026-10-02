import * as fs from "fs";
import * as path from "path";
import * as proveedor from "./src/tools/proveedor.js";
import * as contratos from "./src/tools/contratos.js";
import * as oc from "./src/tools/oc.js";

const OUT = path.join(process.cwd(), "out");
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ctx = { directory: process.cwd(), sessionId: "demo" };

console.log("=== Demo sin modelo — Retos 1 · 2 · 3 ===\n");

// ==========================================================================
// Reto 1 — Registro de proveedores
// ==========================================================================
console.log("--- RETO 01 · Proveedores ---");
for (const caso of ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"]) {
  console.log(`\n-- ${caso}`);
  const r1 = await proveedor.leer_solicitud.execute({ caso }, ctx);
  const p1 = JSON.parse(r1);
  console.log("leer_solicitud", p1.ok ? "ok" : p1.error);
  if (p1.ok) {
    const r2 = await proveedor.mapear_campos.execute({ caso, campos: p1.data.campos }, ctx);
    const p2 = JSON.parse(r2);
    console.log("mapear_campos", p2.ok, "llenos:", p2.data?.llenos, "faltantes:", p2.data?.faltantes?.length, "requieren:", p2.data?.requieren_confirmacion);
    if (p2.ok) {
      const r3 = await proveedor.generar_formulario.execute({ caso, mapeo: p2.data }, ctx);
      const p3 = JSON.parse(r3);
      console.log("generar_formulario", p3.data?.ruta || p3.error);
      const r4 = await proveedor.armar_paquete.execute({ caso }, ctx);
      const p4 = JSON.parse(r4);
      console.log("armar_paquete listo=", p4.data?.listo_para_firma, "ausentes=", p4.data?.checklist?.ausentes?.length, "vencidos=", p4.data?.checklist?.vencidos?.length);
    }
  }
}
console.log("\n-- simular_envio sin confirmación");
const r5 = await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: false }, ctx);
console.log(JSON.parse(r5));
console.log("-- simular_envio con confirmación");
const r6 = await proveedor.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx);
console.log(JSON.parse(r6));

// ==========================================================================
// Reto 2 — Contratos
// ==========================================================================
console.log("\n--- RETO 02 · Contratos ---");
const rb = contratos.leer_buzon.execute({}, ctx);
const pb = JSON.parse(rb);
console.log("buzón:", (pb.data?.mensajes || []).map((m: any) => m.id).join(", "));
for (const m of pb.data?.mensajes || []) {
  console.log(`\n-- ${m.id} (${m.de})`);
  const rE = contratos.extraer.execute({ mensaje_id: m.id }, ctx);
  const pE = JSON.parse(rE);
  if (!pE.ok) { console.log("extraer:", pE.error); continue; }
  const rV = contratos.validar.execute({ mensaje_id: m.id, contrato: pE.data.contrato }, ctx);
  const pV = JSON.parse(rV);
  console.log("validar:", pV.data?.clasificacion, "revisión:", pV.data?.requiere_revision?.join(",") || "-");
  const rR = contratos.registrar.execute({ mensaje_id: m.id, contrato: pE.data.contrato, clasificacion: pV.data.clasificacion }, ctx);
  const pR = JSON.parse(rR);
  console.log("registrar:", pR.ok ? `${pR.data.accion} ${pR.data.id_contrato}` : pR.error);
}
console.log("\n-- alertas (hoy = 2026-09-03)");
const rA = contratos.alertas.execute({ hoy: "2026-09-03" }, ctx);
const pA = JSON.parse(rA);
console.log("vencen:", pA.data?.vencen?.length, "| pólizas:", pA.data?.polizas_pendientes?.length, "| nuevos:", pA.data?.registrados_desde_corte?.length);

// ==========================================================================
// Reto 3 — Órdenes de compra SAP
// ==========================================================================
console.log("\n--- RETO 03 · Órdenes de compra ---");
for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
  console.log(`\n-- ${caso}`);
  const rP = oc.leer_paquete.execute({ caso }, ctx);
  const pP = JSON.parse(rP);
  if (!pP.ok) { console.log("leer_paquete:", pP.error); continue; }
  const rV = await oc.validar.execute({ caso, paquete: pP.data.paquete }, ctx);
  const pV = JSON.parse(rV);
  console.log("validar apta=", pV.data?.apta, "bloqueos=", pV.data?.bloqueos, "confirmaciones=", pV.data?.confirmaciones, "retroactiva=", pV.data?.retroactiva);
  if (pV.data?.apta) {
    const rPayload = await oc.construir_payload.execute({ caso, paquete: pP.data.paquete, derivados: pV.data.derivados }, ctx);
    const pPayload = JSON.parse(rPayload);
    const rEv = await oc.generar_evidencia.execute({ caso }, ctx);
    const rC = await oc.crear.execute({ caso, payload: pPayload.data?.payload, validacion: pV.data }, ctx);
    const pC = JSON.parse(rC);
    console.log("crear:", pC.ok ? `${pC.data.numero_oc} (retroactiva=${pV.data.retroactiva})` : pC.error);
  } else {
    const rC = await oc.crear.execute({ caso, validacion: pV.data }, ctx);
    console.log("crear:", JSON.parse(rC).error || JSON.parse(rC));
  }
}
console.log("\n-- idempotencia sol-001 (segunda ejecución)");
const rP1 = oc.leer_paquete.execute({ caso: "sol-001" }, ctx);
const pP1 = JSON.parse(rP1);
const rV1 = await oc.validar.execute({ caso: "sol-001", paquete: pP1.data.paquete }, ctx);
const rPay1 = await oc.construir_payload.execute({ caso: "sol-001", paquete: pP1.data.paquete, derivados: JSON.parse(rV1).data.derivados }, ctx);
const rC2 = await oc.crear.execute({ caso: "sol-001", payload: JSON.parse(rPay1).data.payload, validacion: JSON.parse(rV1).data }, ctx);
console.log("segunda:", JSON.parse(rC2).data?.numero_oc, "(mismo número que la primera)");

console.log("\n-- confirmación explícita sol-004");
const rP4 = oc.leer_paquete.execute({ caso: "sol-004" }, ctx);
const pP4 = JSON.parse(rP4);
const rV4 = await oc.validar.execute({ caso: "sol-004", paquete: pP4.data.paquete }, ctx);
const pV4 = JSON.parse(rV4);
const rPay4 = await oc.construir_payload.execute({ caso: "sol-004", paquete: pP4.data.paquete, derivados: pV4.data.derivados }, ctx);
const rC4 = await oc.crear.execute({ caso: "sol-004", payload: JSON.parse(rPay4).data.payload, validacion: pV4.data, confirmado: true }, ctx);
console.log("confirmada:", JSON.parse(rC4).ok ? JSON.parse(rC4).data.numero_oc : JSON.parse(rC4).error);

console.log("\n=== Demo terminada ===");
