import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
// pdf-parse/index.js tiene un modo debug que lee un archivo de test al importarse;
// se importa el lib directo para evitarlo.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const ROOT = process.cwd();
const FIXTURES_LOCAL = path.resolve(ROOT, "fixtures/reto-02");
const FIXTURES = fs.existsSync(FIXTURES_LOCAL)
  ? FIXTURES_LOCAL
  : path.resolve(ROOT, "../Retos/reto-02/fixtures/reto-02");
const BUZON = path.join(FIXTURES, "buzon");
const MAESTRO_SRC = path.join(FIXTURES, "maestro-contratos.csv");
const COMERCIALES = path.join(FIXTURES, "comerciales.json");
const OUT = path.resolve(ROOT, "out");
const SHAREPOINT = path.join(OUT, "sharepoint");
const MAESTRO_OUT = path.join(SHAREPOINT, "maestro-contratos.csv");
const PROCESADOS = path.join(OUT, "procesados.json");
const HISTORIAL = path.join(SHAREPOINT, "historial.jsonl");
const LOG = path.join(OUT, "log.jsonl");

function today() {
  return new Date().toISOString().split("T")[0];
}

function ok(data: any) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: string) {
  return JSON.stringify({ ok: false, error });
}

function log(herramienta: string, mensaje_id: string | null, okOk: boolean, resumen: any) {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(
      LOG,
      JSON.stringify({ ts: new Date().toISOString(), herramienta, mensaje_id, ok: okOk, resumen }) + "\n"
    );
  } catch {}
}

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

function parseFechaES(texto: string): string | null {
  const m = texto.match(/(\w+)\s*\((\d{1,2})\)\s*de\s+(\w+)\s+de\s+(\d{4})/i)
    || texto.match(/(\d{1,2})\s*de\s+(\w+)\s+de\s+(\d{4})/i);
  if (!m) return null;
  let dia: string, mesTxt: string, anio: string;
  if (m.length === 5) { dia = m[2]; mesTxt = m[3]; anio = m[4]; }
  else { dia = m[1]; mesTxt = m[2]; anio = m[3]; }
  const mes = MESES[mesTxt.toLowerCase()];
  if (!mes) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(parseInt(dia)).padStart(2, "0")}`;
}

function parseValor(texto: string): { valor: number | null; moneda: string | null; conf: number } {
  if (/no tiene un valor determinado|por demanda|contrato marco no tiene/i.test(texto)) {
    return { valor: 0, moneda: null, conf: 0 };
  }
  const m = texto.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d.,]+)/i);
  if (!m) return { valor: null, moneda: null, conf: 0 };
  const moneda = m[1].toUpperCase();
  const num = parseFloat(m[2].replace(/\./g, "").replace(",", "."));
  if (isNaN(num)) return { valor: null, moneda, conf: 0 };
  return { valor: Math.round(num), moneda, conf: 0.95 };
}

function parseCSV(csv: string): any[] {
  const lines = csv.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).filter((l) => l.trim()).map((l) => {
    const vals = l.split(",");
    const row: any = {};
    headers.forEach((h, i) => (row[h] = vals[i]));
    return row;
  });
}

function toCSV(rows: any[], headers: string[]): string {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") + "\n";
}

const HEADERS = ["id_contrato","cliente","nit_cliente","pais","objeto","valor","moneda","fecha_inicio","fecha_fin","requiere_poliza","tipo_poliza","estado_poliza","comercial","ruta_sharepoint","fecha_registro","fuente"];

function ensureMaestro() {
  fs.mkdirSync(SHAREPOINT, { recursive: true });
  if (!fs.existsSync(MAESTRO_OUT)) {
    fs.copyFileSync(MAESTRO_SRC, MAESTRO_OUT);
  }
}

function loadMaestro(): any[] {
  ensureMaestro();
  return parseCSV(fs.readFileSync(MAESTRO_OUT, "utf-8"));
}

function saveMaestro(rows: any[]) {
  ensureMaestro();
  fs.writeFileSync(MAESTRO_OUT, toCSV(rows, HEADERS));
}

function readJSON(p: string): any {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

// ---------------------------------------------------------------------------
// HU-1 · leer el buzón
// ---------------------------------------------------------------------------
export const leer_buzon = {
  description: "Lista los mensajes pendientes del buzón de contratos con sus metadatos y si traen adjunto de contrato",
  args: {},
  execute(_args: {}, ctx: { directory: string; sessionId: string }) {
    try {
      const procesados = readJSON(PROCESADOS) || {};
      const dirs = fs.readdirSync(BUZON).filter((d) => fs.statSync(path.join(BUZON, d)).isDirectory()).sort();
      const mensajes = dirs.filter((d) => !procesados[d]).map((d) => {
        const correo = readJSON(path.join(BUZON, d, "correo.json")) || {};
        const adjuntos: string[] = correo.adjuntos || [];
        return {
          id: d,
          de: correo.de,
          asunto: correo.asunto,
          fecha: correo.fecha,
          adjuntos,
          tiene_contrato: adjuntos.some((a) => /^(contrato|otrosi)\.(txt|pdf)$/i.test(a)),
        };
      });
      log("contratos_leer_buzon", null, true, `${mensajes.length} mensajes`);
      return ok({ mensajes });
    } catch (e: any) {
      log("contratos_leer_buzon", null, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// P1 opcional · leer PDF nativo con texto (contratos_leer_pdf)
// ---------------------------------------------------------------------------
export const leer_pdf = {
  description: "Extrae el texto de un PDF con texto embebido (adjunto .pdf del buzón u otro documento)",
  args: {
    ruta: z.string().describe("Ruta del PDF relativa al proyecto, ej. fixtures/reto-02/buzon/msg-001/contrato.pdf"),
  },
  async execute(args: { ruta: string }, ctx: { directory: string; sessionId: string }) {
    try {
      const full = path.resolve(ctx?.directory || ROOT, args.ruta);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || !/\.pdf$/i.test(full)) {
        return fail(`No existe o no es PDF: ${args.ruta}`);
      }
      const texto = await pdfTexto(full);
      log("contratos_leer_pdf", null, true, { ruta: args.ruta, chars: texto.length });
      return ok({ texto });
    } catch (e: any) {
      log("contratos_leer_pdf", null, false, e.message);
      return fail(e.message);
    }
  },
};

async function pdfTexto(full: string): Promise<string> {
  // fs.readFileSync devuelve un Buffer sobre un pool compartido; pdf.js lee
  // buffer.byteOffset mal → "bad XRef entry". Se copia a un Uint8Array limpio.
  const data = await pdfParse(new Uint8Array(fs.readFileSync(full)) as unknown as Buffer);
  return data.text;
}

async function docTexto(full: string): Promise<string> {
  if (/\.pdf$/i.test(full)) return pdfTexto(full);
  return fs.readFileSync(full, "utf-8");
}

// ---------------------------------------------------------------------------
// HU-2 · extraer datos del contrato con confianza por campo
// ---------------------------------------------------------------------------
export const extraer = {
  description: "Extrae los datos estructurados del contrato adjunto de un mensaje, con nivel de confianza por campo",
  args: {
    mensaje_id: z.string().describe("ID del mensaje en el buzón (msg-001 a msg-006)"),
  },
  async execute(args: { mensaje_id: string }, ctx: { directory: string; sessionId: string }) {
    try {
      const dir = path.join(BUZON, args.mensaje_id);
      const correo = readJSON(path.join(dir, "correo.json"));
      if (!correo) return fail(`Mensaje ${args.mensaje_id} no existe`);

      const adjuntos: string[] = correo.adjuntos || [];
      const doc = adjuntos.find((a) => /^(contrato|otrosi)\.(txt|pdf)$/i.test(a));
      if (!doc) return fail("Sin adjunto de contrato");
      const texto = await docTexto(path.join(dir, doc));
      const esOtrosi = /^otrosi\./i.test(doc) || /OTROS[IÍ]/i.test(texto);

      // id_contrato
      let id_contrato: string | null = null;
      let idConf = 0;
      const mId = texto.match(/No\.?\s*([A-Z]+-\d{4}-\d+)/i);
      if (mId) { id_contrato = mId[1]; idConf = 0.95; }
      else { idConf = 0.3; }

      // cliente y nit
      let cliente: string | null = null;
      let cliConf = 0;
      const mCli = texto.match(/Entre(?: los suscritos)?,?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.,\-]+?),\s*(?:identificad[ao]|NIT|RUC)/);
      if (mCli) { cliente = mCli[1].trim().replace(/\s+/g, " "); cliConf = 0.9; }

      let nit: string | null = null;
      let nitConf = 0;
      const mNit = texto.match(/NIT\s*([\d.]+)(?:-\d)?/i) || texto.match(/RUC\s*(\d+)/i);
      if (mNit) { nit = mNit[1].replace(/\./g, ""); nitConf = 0.95; }

      // pais
      let pais: string | null = null;
      let paisConf = 0;
      if (/Bogotá|Medellín|Barranquilla|Colombia/i.test(texto) || /^89/.test(nit || "")) { pais = "CO"; paisConf = 0.9; }
      if (/Quito|Ecuador/i.test(texto) || /^179/.test(nit || "")) { pais = "EC"; paisConf = 0.9; }
      if (/Lima|Perú|Peru/i.test(texto) || /^205/.test(nit || "")) { pais = "PE"; paisConf = 0.9; }
      if (/Tegucigalpa|Honduras/i.test(texto)) { pais = "HN"; paisConf = 0.9; }
      if (/Panamá/i.test(texto)) { pais = "PA"; paisConf = 0.9; }

      // objeto
      let objeto: string | null = null;
      let objConf = 0;
      const mObj = texto.match(/OBJETO\.\s*(.+?)(?:SEGUNDA\.|SEGUNDA\.|\n\n[A-ZÁÉÍÓÚÑ]+\.)/is);
      if (mObj) {
        objeto = mObj[1].replace(/\s+/g, " ").trim().slice(0, 200);
        objConf = 0.85;
      }

      // valor y moneda
      const val = parseValor(texto);
      const valor = val.valor;
      const moneda = val.moneda;
      const valorConf = val.conf;

      // fechas (confianza independiente por campo)
      let fecha_inicio: string | null = null;
      let fecha_fin: string | null = null;
      let fiConf = 0;
      let ffConf = 0;
      const mFechas = texto.match(/desde\s+el\s+(.+?)\s+hasta\s+(?:el\s+)?(.+?)(?:\.|\n|$)/i);
      if (mFechas) {
        fecha_inicio = parseFechaES(mFechas[1]);
        fecha_fin = parseFechaES(mFechas[2]);
        fiConf = fecha_inicio ? 0.95 : 0.4;
        ffConf = fecha_fin ? 0.95 : 0.4;
      } else if (/a partir de la fecha de su firma/i.test(texto)) {
        fecha_inicio = correo.fecha ? correo.fecha.split("T")[0] : null;
        fecha_fin = null;
        fiConf = fecha_inicio ? 0.85 : 0;
        ffConf = 0;
      } else {
        fiConf = 0.3;
        ffConf = 0.3;
      }

      // otrosí: fechas modificadas
      if (esOtrosi) {
        const mExt = texto.match(/se extiende hasta (?:el\s+)?(.+?)(?:"|\n|\.)/i);
        if (mExt) { const f = parseFechaES(mExt[1]); if (f) { fecha_fin = f; ffConf = 0.95; } }
      }

      // póliza
      const requiere_poliza = /p[óo]liza/i.test(texto);
      const polConf = requiere_poliza ? 0.95 : 0.85;
      const tipos: string[] = [];
      if (/p[óo]liza de cumplimiento/i.test(texto)) tipos.push("cumplimiento");
      if (/responsabilidad civil/i.test(texto)) tipos.push("responsabilidad_civil");
      if (/calidad/i.test(texto)) tipos.push("calidad");
      if (/salarios y prestaciones/i.test(texto)) tipos.push("salarios_prestaciones");

      // comercial desde correo
      const comerciales = readJSON(COMERCIALES) || [];
      const remitente = correo.de?.toLowerCase().trim();
      const com = comerciales.find((c: any) => c.email.toLowerCase() === remitente);
      const comercial = com ? com.nombre : correo.de || null;
      const comConf = com ? 0.95 : 0.3;

      const contrato = {
        id_contrato: { valor: id_contrato, confianza: idConf },
        cliente: { valor: cliente, confianza: cliConf },
        nit_cliente: { valor: nit, confianza: nitConf },
        pais: { valor: pais, confianza: paisConf },
        objeto: { valor: objeto, confianza: objConf },
        valor: { valor, confianza: valorConf },
        moneda: { valor: moneda, confianza: moneda ? 0.95 : 0 },
        fecha_inicio: { valor: fecha_inicio, confianza: fiConf },
        fecha_fin: { valor: fecha_fin, confianza: ffConf },
        requiere_poliza: { valor: requiere_poliza, confianza: polConf },
        tipo_poliza: { valor: tipos.join(";"), confianza: polConf },
        comercial: { valor: comercial, confianza: comConf },
        es_otrosi: esOtrosi,
        valor_indeterminado: /no tiene un valor determinado/i.test(texto),
        remitente_reconocido: Boolean(com),
      };
      log("contratos_extraer", args.mensaje_id, true, { id: id_contrato });
      return ok({ contrato });
    } catch (e: any) {
      log("contratos_extraer", args.mensaje_id, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// HU-3 · validar y clasificar contra el maestro
// ---------------------------------------------------------------------------
export const validar = {
  description: "Clasifica el contrato como nuevo, actualización, duplicado o rechazado comparando con el maestro y la confianza",
  args: {
    mensaje_id: z.string().describe("ID del mensaje en el buzón"),
    contrato: z.any().describe("Objeto contrato devuelto por contratos_extraer"),
  },
  execute(args: { mensaje_id: string; contrato: any }, ctx: { directory: string; sessionId: string }) {
    try {
      const c = args.contrato;
      if (!c) return fail("Falta contrato extraído");
      const requiere_revision: string[] = [];
      // En un otrosí solo interesan los campos que el documento modifica
      const campos = c.es_otrosi
        ? ["id_contrato", "valor", "fecha_fin"]
        : ["id_contrato","cliente","nit_cliente","pais","objeto","valor","moneda","fecha_inicio","fecha_fin","requiere_poliza","comercial"];
      for (const k of campos) {
        const f = c[k];
        // El remitente desconocido se reporta pero no bloquea; un contrato marco sin valor tampoco exige moneda
        if (k === "comercial" && c.remitente_reconocido === false) continue;
        if (k === "moneda" && c.valor_indeterminado) continue;
        if (f && typeof f === "object" && "confianza" in f && f.confianza < 0.8) requiere_revision.push(k);
      }

      const id = c.id_contrato?.valor;
      const maestro = loadMaestro();
      const existente = maestro.find((r) => r.id_contrato === id);

      let clasificacion: string;
      let diferencias: string[] = [];
      if (!id && !c.cliente?.valor) {
        clasificacion = "rechazado";
      } else if (existente) {
        const val = c.valor?.valor;
        const fi = c.fecha_inicio?.valor;
        const ff = c.fecha_fin?.valor;
        const mismo = String(existente.valor) === String(val) && existente.fecha_inicio === fi && existente.fecha_fin === ff;
        if (c.es_otrosi || !mismo) {
          clasificacion = "actualizacion";
          if (val !== null && val !== undefined && String(existente.valor) !== String(val)) diferencias.push(`valor: ${existente.valor} → ${val}`);
          if (ff && existente.fecha_fin !== ff) diferencias.push(`fecha_fin: ${existente.fecha_fin} → ${ff}`);
          if (fi && existente.fecha_inicio !== fi) diferencias.push(`fecha_inicio: ${existente.fecha_inicio} → ${fi}`);
          if (c.moneda?.valor && existente.moneda !== c.moneda.valor) diferencias.push(`moneda: ${existente.moneda} → ${c.moneda.valor}`);
        } else {
          clasificacion = "duplicado";
        }
      } else {
        clasificacion = "nuevo";
      }
      if (!c.remitente_reconocido && !requiere_revision.includes("comercial")) {
        // remitente desconocido se reporta pero no bloquea
      }
      const data = { clasificacion, id_contrato_existente: existente ? existente.id_contrato : null, requiere_revision, diferencias };
      log("contratos_validar", args.mensaje_id, true, data);
      return ok(data);
    } catch (e: any) {
      log("contratos_validar", args.mensaje_id, false, e.message);
      return fail(e.message);
    }
  },
};

// ---------------------------------------------------------------------------
// HU-4 · registrar y archivar
// ---------------------------------------------------------------------------
export const registrar = {
  description: "Registra el contrato en el maestro de SharePoint, archiva el documento y marca el mensaje como procesado",
  args: {
    mensaje_id: z.string().describe("ID del mensaje en el buzón"),
    contrato: z.any().describe("Objeto contrato devuelto por contratos_extraer"),
    clasificacion: z.string().describe("Clasificación de contratos_validar: nuevo|actualizacion|duplicado|rechazado"),
    confirmado: z.boolean().optional().describe("Confirmación humana para registrar con campos en revisión"),
  },
  execute(args: { mensaje_id: string; contrato: any; clasificacion: string; confirmado?: boolean }, ctx: { directory: string; sessionId: string }) {
    try {
      const c = args.contrato;
      if (args.clasificacion === "rechazado" || args.clasificacion === "duplicado") {
        marcarProcesado(args.mensaje_id);
        log("contratos_registrar", args.mensaje_id, true, args.clasificacion);
        return ok({ id_contrato: c.id_contrato?.valor, accion: args.clasificacion, ruta_archivo: null });
      }
      const v = JSON.parse(validar.execute({ mensaje_id: args.mensaje_id, contrato: c }, ctx));
      if (!v.ok) return fail(v.error);
      if (v.data.requiere_revision.length > 0 && !args.confirmado) {
        return fail(`requiere revisión: ${v.data.requiere_revision.join(", ")}`);
      }
      const rows = loadMaestro();
      const f = (k: string) => c[k]?.valor ?? null;
      const id = f("id_contrato") || `AUTO-${today().slice(0, 4)}-${String(rows.length + 1).padStart(3, "0")}`;
      const anio = (f("fecha_inicio") || today()).slice(0, 4);
      const clienteSlug = slug(f("cliente") || "sin-cliente");
      const relDir = `Contratos/${anio}/${clienteSlug}`;
      const srcDir = path.join(BUZON, args.mensaje_id);
      const correo = readJSON(path.join(srcDir, "correo.json"));
      const adjunto = (correo?.adjuntos || []).find((a: string) => a === "contrato.txt" || a === "otrosi.txt");
      const rutaRel = `${relDir}/${id}.txt`;
      const destDir = path.join(SHAREPOINT, relDir);
      fs.mkdirSync(destDir, { recursive: true });
      if (adjunto) fs.copyFileSync(path.join(srcDir, adjunto), path.join(SHAREPOINT, rutaRel));

      const row: any = {
        id_contrato: id,
        cliente: f("cliente") || "",
        nit_cliente: f("nit_cliente") || "",
        pais: f("pais") || "",
        objeto: f("objeto") || "",
        valor: f("valor") ?? 0,
        moneda: f("moneda") || "",
        fecha_inicio: f("fecha_inicio") || "",
        fecha_fin: f("fecha_fin") || "",
        requiere_poliza: f("requiere_poliza") ? "true" : "false",
        tipo_poliza: f("tipo_poliza") || "",
        estado_poliza: f("requiere_poliza") ? "pendiente" : "no_aplica",
        comercial: f("comercial") || "",
        ruta_sharepoint: rutaRel,
        fecha_registro: today(),
        fuente: "buzon",
      };
      const cambios: any[] = [];
      if (args.clasificacion === "actualizacion") {
        const idx = rows.findIndex((r) => r.id_contrato === id);
        if (idx >= 0) {
          const prev = rows[idx];
          for (const k of ["valor","fecha_inicio","fecha_fin","moneda","tipo_poliza","estado_poliza"]) {
            if (String(row[k]) !== "" && String(prev[k]) !== String(row[k])) {
              cambios.push({ campo: k, antes: prev[k], despues: row[k] });
              prev[k] = row[k];
            }
          }
          prev.ruta_sharepoint = rutaRel;
        }
      } else {
        rows.push(row);
      }
      saveMaestro(rows);
      fs.appendFileSync(
        HISTORIAL,
        JSON.stringify({ ts: new Date().toISOString(), id_contrato: id, accion: args.clasificacion, cambios, mensaje_id: args.mensaje_id }) + "\n"
      );
      marcarProcesado(args.mensaje_id);
      log("contratos_registrar", args.mensaje_id, true, { id, accion: args.clasificacion });
      return ok({ id_contrato: id, accion: args.clasificacion, ruta_archivo: rutaRel });
    } catch (e: any) {
      log("contratos_registrar", args.mensaje_id, false, e.message);
      return fail(e.message);
    }
  },
};

function marcarProcesado(id: string) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = readJSON(PROCESADOS) || {};
  p[id] = new Date().toISOString();
  fs.writeFileSync(PROCESADOS, JSON.stringify(p, null, 2));
}

// ---------------------------------------------------------------------------
// HU-5 · alertas de vencimiento y pólizas pendientes
// ---------------------------------------------------------------------------
export const alertas = {
  description: "Genera el reporte de alertas: contratos que vencen en ≤60 días, pólizas pendientes y registros desde el corte",
  args: {
    hoy: z.string().describe("Fecha de referencia YYYY-MM-DD para el reporte determinista"),
  },
  execute(args: { hoy: string }, ctx: { directory: string; sessionId: string }) {
    try {
      const rows = loadMaestro();
      const ref = new Date(args.hoy + "T00:00:00");
      const en60 = new Date(ref.getTime() + 60 * 86400000);
      const corte = "2026-05-30";
      const vencen = rows.filter((r) => r.fecha_fin && r.fecha_fin >= args.hoy && r.fecha_fin <= en60.toISOString().split("T")[0]);
      const polizas = rows.filter((r) => r.requiere_poliza === "true" && r.estado_poliza !== "vigente" && r.estado_poliza !== "no_aplica");
      const nuevos = rows.filter((r) => r.fecha_registro > corte);
      const md = [
        `# Alertas de contratos — ${args.hoy}`,
        "",
        `## Vencen en ≤ 60 días (${vencen.length})`,
        ...vencen.map((r) => `- ${r.id_contrato} · ${r.cliente} · vence ${r.fecha_fin}`),
        "",
        `## Pólizas pendientes o vencidas (${polizas.length})`,
        ...polizas.map((r) => `- ${r.id_contrato} · ${r.cliente} · estado ${r.estado_poliza} · tipos ${r.tipo_poliza}`),
        "",
        `## Registrados desde el corte ${corte} (${nuevos.length})`,
        ...nuevos.map((r) => `- ${r.id_contrato} · ${r.cliente} · registrado ${r.fecha_registro}`),
        "",
      ].join("\n");
      fs.mkdirSync(OUT, { recursive: true });
      const ruta = path.join(OUT, "alertas.md");
      fs.writeFileSync(ruta, md);
      log("contratos_alertas", null, true, { vencen: vencen.length, polizas: polizas.length, nuevos: nuevos.length });
      return ok({ ruta, vencen, polizas_pendientes: polizas, registrados_desde_corte: nuevos });
    } catch (e: any) {
      log("contratos_alertas", null, false, e.message);
      return fail(e.message);
    }
  },
};

export const TOOLS: Record<string, any> = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas,
};
