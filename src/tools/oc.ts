import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mockSap } from "../sap/mock.js";
import type { OrdenCompra } from "../sap/adapter.js";

const ROOT = process.cwd();
const FIXTURES_LOCAL = path.resolve(ROOT, "fixtures/reto-03");
const FIXTURES = fs.existsSync(FIXTURES_LOCAL)
  ? FIXTURES_LOCAL
  : path.resolve(ROOT, "../Retos/reto-03/fixtures/reto-03");
const SOLICITUDES = path.join(FIXTURES, "solicitudes");
const MAESTROS = path.join(FIXTURES, "maestros");
const OUT = path.resolve(ROOT, "out");
const CONTROL = path.join(OUT, "control.csv");
const LOG = path.join(OUT, "log.jsonl");

function ok(data: any) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: string) {
  return JSON.stringify({ ok: false, error });
}

function log(herramienta: string, caso: string | null, okOk: boolean, resumen: any) {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(
      LOG,
      JSON.stringify({ ts: new Date().toISOString(), herramienta, caso, ok: okOk, resumen }) + "\n"
    );
  } catch {}
}

function readJSON(p: string): any {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

function readText(p: string): string | null {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
}

function normStr(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function normNit(s: string | null | undefined) {
  return (s || "").replace(/[.\-]/g, "");
}

// ---------------------------------------------------------------------------
// HU-1 · leer el paquete
// ---------------------------------------------------------------------------
export const leer_paquete = {
  description: "Lee el paquete de una solicitud (correo, solicitud, cotización, aprobación y factura si existe)",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (sol-001 a sol-006)"),
  },
  execute(args: { caso: string }, ctx: { directory: string; sessionId: string }) {
    try {
      const dir = path.join(SOLICITUDES, args.caso);
      if (!fs.existsSync(dir)) return fail(`Caso ${args.caso} no existe`);

      const correo = readJSON(path.join(dir, "correo.json"));
      const solicitud = readJSON(path.join(dir, "solicitud.json"));
      const cotTxt = readText(path.join(dir, "cotizacion.txt"));
      const aprob = readJSON(path.join(dir, "aprobacion.json"));
      const facTxt = readText(path.join(dir, "factura.txt"));

      let cotizacion: any = null;
      if (cotTxt) {
        const prov = cotTxt.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() || null;
        const nit = cotTxt.match(/NIT:\s*([\d.\-]+)/i)?.[1]?.trim() || null;
        const total = cotTxt.match(/TOTAL(?:\s*\(IVA incluido\))?:\s*([A-Z]+)\s*([\d.,]+)/i);
        const validez = cotTxt.match(/Validez de la oferta:\s*(\d+)\s*días/i)?.[1] || null;
        cotizacion = {
          proveedor: prov,
          nit: nit ? normNit(nit) : null,
          total: total ? Math.round(parseFloat(total[2].replace(/\./g, "").replace(",", "."))) : null,
          moneda: total ? total[1].toUpperCase() : null,
          validez_hasta: null,
          validez_dias: validez ? parseInt(validez) : null,
          texto: cotTxt,
        };
      }

      let aprobacion: any = null;
      if (aprob) {
        aprobacion = {
          de: aprob.de,
          para: aprob.para,
          fecha: aprob.fecha,
          asunto: aprob.asunto,
          aprobado: /aprobado/i.test(aprob.cuerpo || ""),
          texto: aprob.cuerpo || "",
        };
      }

      let factura: any = null;
      if (facTxt) {
        const numero = facTxt.match(/No\.\s*([A-Z]+-\d+)/i)?.[1] || null;
        const fecha = facTxt.match(/Fecha de emisión:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || null;
        const total = facTxt.match(/TOTAL:\s*([A-Z]+)\s*([\d.,]+)/i);
        factura = {
          numero,
          fecha,
          total: total ? Math.round(parseFloat(total[2].replace(/\./g, "").replace(",", "."))) : null,
          texto: facTxt,
        };
      }

      const paquete = {
        correo: correo ? { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha } : null,
        solicitud: solicitud || null,
        cotizacion,
        aprobacion,
        factura,
      };
      log("oc_leer_paquete", args.caso, true, { correo: Boolean(correo), solicitud: Boolean(solicitud) });
      return ok({ paquete });
    } catch (e: any) {
      log("oc_leer_paquete", args.caso, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// HU-2 · validar contra maestros y controles RC1-RC10
// ---------------------------------------------------------------------------
export const validar = {
  description: "Valida el paquete contra los maestros y controles; devuelve bloqueos, confirmaciones, derivados y retroactiva",
  args: {
    caso: z.string().describe("Caso a validar"),
    paquete: z.any().describe("Paquete normalizado devuelto por oc_leer_paquete"),
  },
  async execute(args: { caso: string; paquete: any }, ctx: { directory: string; sessionId: string }) {
    try {
      const p = args.paquete;
      if (!p || !p.solicitud) return fail("Paquete incompleto: falta solicitud");
      const s = p.solicitud;
      const bloqueos: string[] = [];
      const confirmaciones: string[] = [];
      const derivados: any = {};
      let retroactiva = false;

      const provs = readJSON(path.join(MAESTROS, "proveedores.json")) || [];
      const ccs = readJSON(path.join(MAESTROS, "centros-costo.json")) || [];
      const ivas = readJSON(path.join(MAESTROS, "indicadores-iva.json")) || [];
      const conds = readJSON(path.join(MAESTROS, "condiciones-pago.json")) || [];

      // RC1 proveedor
      const nitSol = normNit(s.proveedor_nit);
      let prov = nitSol ? provs.find((x: any) => x.nit === nitSol) : provs.find((x: any) => normStr(x.nombre) === normStr(s.proveedor_nombre || ""));
      if (!prov) {
        bloqueos.push(`Proveedor '${s.proveedor_nombre}' no existe en el maestro de proveedores`);
      } else if (!prov.activo) {
        bloqueos.push(`Proveedor '${prov.nombre}' está inactivo en el maestro`);
      }

      const cc = ccs.find((c: any) => c.centro_costo === s.centro_costo);
      let aprobador: any = null;
      if (!cc) {
        bloqueos.push(`Centro de costo '${s.centro_costo}' no existe en el maestro`);
      } else {
        // RC4 subarea
        if (!cc.subareas.includes(s.subarea)) {
          bloqueos.push(`Subárea '${s.subarea}' no pertenece al centro ${s.centro_costo}`);
        }
        // RC2 aprobación
        if (!p.aprobacion || !p.aprobacion.aprobado) {
          bloqueos.push("No existe aprobación válida (falta o no contiene 'Aprobado')");
        } else {
          aprobador = cc.aprobadores.find((a: any) => a.email.toLowerCase() === p.aprobacion.de.toLowerCase());
          if (!aprobador) {
            bloqueos.push(`El aprobador '${p.aprobacion.de}' no está listado como aprobador del centro ${s.centro_costo}`);
          }
        }
      }

      // RC3 tope
      if (aprobador && s.valor_total > aprobador.tope) {
        bloqueos.push(`El valor ${s.valor_total} supera el tope ${aprobador.tope} del aprobador ${aprobador.email}`);
      }

      // RC5 cotización
      if (p.cotizacion && p.cotizacion.total != null && s.valor_total) {
        const diff = Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total;
        if (diff > 0.02) {
          confirmaciones.push(`La cotización total (${p.cotizacion.total}) difiere de la solicitud (${s.valor_total}) en más del 2 %`);
        }
      } else if (!p.cotizacion) {
        confirmaciones.push("No hay cotización adjunta; confirmar valor de la solicitud");
      }

      // RC6 IVA
      if (!s.indicador_iva) {
        const iva = prov?.indicador_iva_default || ivas.find((i: any) => i.codigo === "C1")?.codigo;
        derivados.indicador_iva = iva;
        confirmaciones.push(`Indicador IVA no informado; se derivará '${iva}' del proveedor`);
      } else if (!ivas.find((i: any) => i.codigo === s.indicador_iva)) {
        bloqueos.push(`Indicador IVA '${s.indicador_iva}' no existe en el maestro`);
      }

      // RC7 condiciones de pago
      if (!s.condiciones_pago) {
        const cond = prov?.condiciones_pago_default || conds.find((c: any) => c.codigo === "Z030")?.codigo;
        derivados.condiciones_pago = cond;
      } else if (!conds.find((c: any) => c.codigo === s.condiciones_pago)) {
        bloqueos.push(`Condición de pago '${s.condiciones_pago}' no existe en el maestro`);
      }

      // RC8 factura retroactiva
      if (p.factura && p.factura.fecha && s.fecha_solicitud && p.factura.fecha < s.fecha_solicitud) {
        retroactiva = true;
        confirmaciones.push(`La factura (${p.factura.fecha}) es anterior a la solicitud (${s.fecha_solicitud}); la OC será retroactiva`);
      }

      // RC9 fecha aprobación >= fecha solicitud
      if (p.aprobacion && p.aprobacion.fecha && s.fecha_solicitud) {
        const fa = p.aprobacion.fecha.split("T")[0];
        if (fa < s.fecha_solicitud) {
          confirmaciones.push(`La aprobación (${fa}) es anterior a la solicitud (${s.fecha_solicitud})`);
        }
      }

      // RC10 cantidad × valor_unitario
      if (s.cantidad != null && s.valor_unitario != null && s.valor_total != null) {
        if (Math.abs(s.cantidad * s.valor_unitario - s.valor_total) > 1) {
          bloqueos.push(`cantidad × valor_unitario (${s.cantidad * s.valor_unitario}) no coincide con valor_total (${s.valor_total})`);
        }
      }

      const apta = bloqueos.length === 0;
      const data = { apta, bloqueos, confirmaciones, derivados, retroactiva };
      log("oc_validar", args.caso, true, data);
      return ok(data);
    } catch (e: any) {
      log("oc_validar", args.caso, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// HU-3 · construir el payload de la OC
// ---------------------------------------------------------------------------
const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z.array(
    z.object({
      numero: z.number(),
      descripcion: z.string().max(40),
      cantidad: z.number(),
      unidad: z.enum(["UN", "H", "MES"]),
      precio_unitario: z.number(),
      centro_costo: z.string(),
      subarea: z.string(),
      indicador_iva: z.string(),
    })
  ),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })
  ),
});

export const construir_payload = {
  description: "Construye el payload de la orden de compra validado con zod y guarda la trazabilidad",
  args: {
    caso: z.string().describe("Caso"),
    paquete: z.any().describe("Paquete normalizado"),
    derivados: z.any().describe("Derivados devueltos por oc_validar"),
  },
  async execute(args: { caso: string; paquete: any; derivados: any }, ctx: { directory: string; sessionId: string }) {
    try {
      const p = args.paquete;
      const s = p.solicitud;
      const provs = readJSON(path.join(MAESTROS, "proveedores.json")) || [];
      const nitSol = normNit(s.proveedor_nit);
      const prov = nitSol ? provs.find((x: any) => x.nit === nitSol) : provs.find((x: any) => normStr(x.nombre) === normStr(s.proveedor_nombre));
      if (!prov) return fail("Proveedor no encontrado");

      const evidenciaSha = createHash("sha256").update(p.aprobacion?.texto || "").digest("hex");
      const cotRef = p.cotizacion ? (p.cotizacion.texto.match(/COTIZACIÓN\s+([A-Z0-9\-]+)/i)?.[1] || null) : null;

      const payload: OrdenCompra = {
        referencia: {
          solicitud_id: s.solicitud_id,
          correo_id: p.correo?.id || args.caso,
          cotizacion_ref: cotRef,
        },
        sociedad: "1000",
        organizacion_compras: "1000",
        proveedor: { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre },
        moneda: s.moneda === "USD" ? "USD" : "COP",
        condiciones_pago: s.condiciones_pago || args.derivados?.condiciones_pago || "Z030",
        aprobador: {
          email: p.aprobacion?.de || "",
          fecha_aprobacion: p.aprobacion?.fecha?.split("T")[0] || "",
          evidencia_sha256: evidenciaSha,
        },
        posiciones: [
          {
            numero: 10,
            descripcion: (s.descripcion || "").slice(0, 40),
            cantidad: s.cantidad,
            unidad: s.cantidad > 1 ? "UN" : "UN",
            precio_unitario: s.valor_unitario,
            centro_costo: s.centro_costo,
            subarea: s.subarea,
            indicador_iva: s.indicador_iva || args.derivados?.indicador_iva || "C1",
          },
        ],
        excepciones: [],
      };
      const parsed = OrdenCompraSchema.safeParse(payload);
      if (!parsed.success) return fail(`Payload inválido: ${parsed.error.issues.map((i) => i.message).join("; ")}`);

      const dir = path.join(OUT, args.caso);
      fs.mkdirSync(dir, { recursive: true });
      const traz = {
        solicitud: path.join("solicitudes", args.caso, "solicitud.json"),
        cotizacion: cotRef,
        maestro_proveedor: prov.codigo_sap,
        derivados: args.derivados,
        payload,
      };
      const ruta = path.join(dir, "trazabilidad.json");
      fs.writeFileSync(ruta, JSON.stringify(traz, null, 2));
      log("oc_construir_payload", args.caso, true, { oc: true });
      return ok({ payload: parsed.data, ruta_trazabilidad: ruta });
    } catch (e: any) {
      log("oc_construir_payload", args.caso, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// HU-4 · generar evidencia de aprobación (txt + pdf)
// ---------------------------------------------------------------------------
export const generar_evidencia = {
  description: "Genera la evidencia de aprobación en txt (P0) y PDF (P1) con sha256",
  args: {
    caso: z.string().describe("Caso"),
  },
  async execute(args: { caso: string }, ctx: { directory: string; sessionId: string }) {
    try {
      const dir = path.join(SOLICITUDES, args.caso);
      const aprob = readJSON(path.join(dir, "aprobacion.json"));
      if (!aprob) return fail("No hay aprobación para generar evidencia");
      const txt = [
        `De: ${aprob.de}`,
        `Para: ${aprob.para}`,
        `Fecha: ${aprob.fecha}`,
        `Asunto: ${aprob.asunto}`,
        "",
        aprob.cuerpo || "",
      ].join("\n");
      const sha = createHash("sha256").update(txt).digest("hex");
      const outDir = path.join(OUT, args.caso);
      fs.mkdirSync(outDir, { recursive: true });
      const rutaTxt = path.join(outDir, "aprobacion.txt");
      fs.writeFileSync(rutaTxt, txt);

      const pdf = await PDFDocument.create();
      const page = pdf.addPage([595, 842]);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      let y = 800;
      for (const linea of txt.split("\n")) {
        page.drawText(linea.slice(0, 90), { x: 40, y, size: 10, font });
        y -= 14;
      }
      const bytes = await pdf.save();
      const rutaPdf = path.join(outDir, "aprobacion.pdf");
      fs.writeFileSync(rutaPdf, bytes);

      log("oc_generar_evidencia", args.caso, true, { sha });
      return ok({ ruta_txt: rutaTxt, ruta_pdf: rutaPdf, sha256: sha });
    } catch (e: any) {
      log("oc_generar_evidencia", args.caso, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// HU-5 · crear la OC en SAP simulado (idempotente)
// ---------------------------------------------------------------------------
export const crear = {
  description: "Crea la orden de compra en SAP simulado si es apta y confirmada; escribe control.csv",
  args: {
    caso: z.string().describe("Caso"),
    payload: z.any().optional().describe("Payload OrdenCompra validado por oc_construir_payload (omitir si está bloqueada)"),
    validacion: z.any().describe("Resultado de oc_validar (apta, bloqueos, confirmaciones, retroactiva)"),
    confirmado: z.boolean().optional().describe("Confirmación humana para crear con confirmaciones pendientes"),
  },
  async execute(args: { caso: string; payload?: any; validacion: any; confirmado?: boolean }, ctx: { directory: string; sessionId: string }) {
    try {
      const v = args.validacion || {};
      const resultado = !v.apta ? "bloqueada" : v.confirmaciones?.length && !args.confirmado ? "pendiente" : "creada";
      const retro = Boolean(v.retroactiva);
      const solicitudId = args.payload?.referencia?.solicitud_id || args.caso;
      let numero_oc: string | null = null;
      let fecha: string | null = null;
      let idempotente = false;

      if (resultado === "creada" && args.payload) {
        const prev = await mockSap.buscarOrdenPorReferencia(solicitudId);
        const r = await mockSap.crearOrden(args.payload as OrdenCompra);
        numero_oc = r.numero_oc;
        fecha = r.fecha;
        idempotente = Boolean(prev);
      }
      const line = [
        args.payload?.referencia?.solicitud_id || args.caso,
        resultado,
        numero_oc || "",
        retro ? "true" : "false",
        (v.bloqueos || []).join("; "),
        (v.confirmaciones || []).join("; "),
        new Date().toISOString(),
      ].join(",");
      fs.mkdirSync(OUT, { recursive: true });
      if (!fs.existsSync(CONTROL)) fs.writeFileSync(CONTROL, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n");
      fs.appendFileSync(CONTROL, line + "\n");
      log("oc_crear", args.caso, resultado === "creada", { resultado, numero_oc });

      if (resultado === "bloqueada") return fail(`Bloqueada: ${(v.bloqueos || []).join("; ")}`);
      if (resultado === "pendiente") return fail(`Requiere confirmación: ${(v.confirmaciones || []).join("; ")}`);
      return ok({ numero_oc, fecha, idempotente });
    } catch (e: any) {
      log("oc_crear", args.caso, false, e.message);
      return fail(e.message);
    }
  },
};

export const TOOLS: Record<string, any> = {
  oc_leer_paquete: leer_paquete,
  oc_validar: validar,
  oc_construir_payload: construir_payload,
  oc_generar_evidencia: generar_evidencia,
  oc_crear: crear,
};
