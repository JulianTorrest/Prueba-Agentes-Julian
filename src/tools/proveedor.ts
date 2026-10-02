import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts } from "pdf-lib";

const ROOT = process.cwd();
const FIXTURES_LOCAL = path.resolve(ROOT, "fixtures/reto-01");
const FIXTURES = fs.existsSync(FIXTURES_LOCAL)
  ? FIXTURES_LOCAL
  : path.resolve(ROOT, "../Retos/reto-01/fixtures/reto-01");
const OUT = path.resolve(ROOT, "out");
const SOPORTES = path.join(FIXTURES, "repositorio/soportes");

function today() {
  return new Date().toISOString().split("T")[0];
}

function loadJson(p: string): any {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function maestro(): any {
  return loadJson(path.join(FIXTURES, "repositorio/maestro.json")) || {};
}

function glosario(): Record<string, string> {
  return loadJson(path.join(FIXTURES, "glosario-campos.json")) || {};
}

function normalize(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getNested(obj: any, dotted: string, def: any = null): any {
  for (const part of dotted.split(".")) {
    if (obj && typeof obj === "object") {
      obj = obj[part] ?? def;
      if (obj == null) return def;
    } else {
      return def;
    }
  }
  return obj;
}

function formatValue(clave: string, valor: any): string {
  if (clave === "ingresos_ultimo_ano.valor" && typeof valor === "number") {
    const moneda = getNested(maestro(), "ingresos_ultimo_ano.moneda", "");
    return `${valor} ${moneda}`.trim();
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (valor == null) return "";
  return String(valor);
}

function fuzzyScore(a: string, b: string): number {
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  let matches = 0;
  for (const aw of aParts) {
    if (bParts.some((bw) => bw.startsWith(aw) || aw.startsWith(bw) || bw === aw)) matches++;
  }
  return matches / Math.max(aParts.length, bParts.length);
}

function buscarMejorEtiqueta(etiqueta: string, glosario: Record<string, string>): [string | null, number] {
  const byNorm: Record<string, string> = {};
  for (const [k, v] of Object.entries(glosario)) byNorm[normalize(k)] = v;
  const norm = normalize(etiqueta);
  if (byNorm[norm]) return [byNorm[norm], 1.0];
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const k of Object.keys(byNorm)) {
    const score = fuzzyScore(norm, k);
    if (score > bestScore) {
      bestScore = score;
      bestKey = k;
    }
  }
  if (bestKey && bestScore >= 0.7) return [byNorm[bestKey], bestScore];
  return [null, bestScore];
}

function logTool(caso: string, herramienta: string, ok: boolean, resumen: any) {
  const dir = path.join(OUT, caso);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    herramienta,
    ok,
    resumen,
  }) + "\n";
  fs.appendFileSync(path.join(dir, "log.jsonl"), line);
}

function sanitize(s: string): string {
  return s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
}

function crearBorrador(caso: string, info: any, mapeo: any, presentes: any[], ausentes: any[], vencidos: any[], listo: boolean): string {
  const lines = [
    `# Borrador de correo - ${caso}`,
    "",
    `**Para:** ${info.cliente || "Cliente"}`,
    "**Asunto:** Adjunto formulario y soportes de registro como proveedor",
    "",
    "Buenos días,",
    "",
    "Adjuntamos el formulario de registro como proveedor debidamente diligenciado junto con los soportes disponibles.",
    "",
    "## Soportes incluidos",
  ];
  for (const p of presentes) lines.push(`- ${p.tipo}: ${p.archivo}`);
  if (!presentes.length) lines.push("- Ninguno");
  if (ausentes.length) {
    lines.push("", "## Soportes faltantes");
    for (const a of ausentes) lines.push(`- ${a.tipo}: ${a.motivo || "No disponible"}`);
  }
  if (vencidos.length) {
    lines.push("", "## Soportes vencidos");
    for (const v of vencidos) lines.push(`- ${v.tipo}: ${v.archivo} (vigencia ${v.vigencia_hasta || "?"})`);
  }
  if (mapeo.requiere_confirmacion?.length) {
    lines.push("", "## Campos que requieren confirmación");
    for (const r of mapeo.requiere_confirmacion) lines.push(`- ${r.etiqueta}: ${r.nota || ""}`);
  }
  if (mapeo.faltantes?.length) {
    lines.push("", "## Campos faltantes en el repositorio");
    for (const f of mapeo.faltantes) lines.push(`- ${f.etiqueta}`);
  }
  lines.push("", "Quedamos atentos a sus indicaciones para la firma del representante legal.", "", `**Estado:** ${listo ? "Listo para firma" : "Pendiente"}`);
  return lines.join("\n");
}

function crearChecklist(caso: string, info: any, mapeo: any, presentes: any[], ausentes: any[], vencidos: any[], listo: boolean): string {
  const lines = [
    `# Checklist - ${caso}`,
    `**Cliente:** ${info.cliente || ""}`,
    `**País:** ${info.pais || ""}`,
    `**Formato:** ${info.formato || ""}`,
    `**Fecha:** ${info.fecha || ""}`,
    "",
    "## Campos llenos",
  ];
  const confirmSet = new Set((mapeo.requiere_confirmacion || []).map((r: any) => r.etiqueta));
  for (const l of mapeo.llenos || []) {
    const mark = confirmSet.has(l.etiqueta) ? "(!)" : "OK";
    lines.push(`- ${mark} ${l.etiqueta}: ${l.valor}`);
  }
  if (!mapeo.llenos?.length) lines.push("- Ninguno");
  if (mapeo.faltantes?.length) {
    lines.push("", "## Campos faltantes");
    for (const f of mapeo.faltantes) lines.push(`- ${f.etiqueta}`);
  }
  if (mapeo.requiere_confirmacion?.length) {
    lines.push("", "## Campos con confirmación pendiente");
    for (const r of mapeo.requiere_confirmacion) lines.push(`- ${r.etiqueta}: ${r.nota || ""}`);
  }
  lines.push("", "## Soportes", "### Presentes");
  for (const p of presentes) lines.push(`- ${p.tipo}: ${p.archivo}`);
  if (!presentes.length) lines.push("- Ninguno");
  lines.push("### Ausentes");
  for (const a of ausentes) lines.push(`- ${a.tipo}: ${a.motivo || ""}`);
  if (!ausentes.length) lines.push("- Ninguno");
  lines.push("### Vencidos");
  for (const v of vencidos) lines.push(`- ${v.tipo}: ${v.archivo} (vigencia ${v.vigencia_hasta || ""})`);
  if (!vencidos.length) lines.push("- Ninguno");
  lines.push("", `**Listo para firma:** ${listo ? "Sí" : "No"}`);
  return lines.join("\n");
}

export const leer_solicitud = {
  description: "Lee la solicitud, plantilla y soportes exigidos de un caso.",
  args: z.object({
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  }),
  async execute(args: { caso: string }, ctx: any) {
    try {
      const casoDir = path.join(FIXTURES, "casos", args.caso);
      if (!fs.existsSync(casoDir)) {
        return JSON.stringify({ ok: false, error: `Caso '${args.caso}' no existe.` });
      }
      const sol = loadJson(path.join(casoDir, "solicitud.json"));
      if (!sol) return JSON.stringify({ ok: false, error: "Solicitud corrupta." });
      const fmt = sol.formato || "";
      let campos: any[] = [];
      if (fmt === "xlsx") {
        const plantilla = loadJson(path.join(casoDir, "plantilla-celdas.json")) || [];
        campos = plantilla.map((p: any) => ({
          etiqueta: p.etiqueta,
          hoja: p.hoja,
          celda_etiqueta: p.celda_etiqueta,
          celda_valor: p.celda_valor,
        }));
      } else if (fmt === "pdf" || fmt === "portal") {
        const plantilla = loadJson(path.join(casoDir, "plantilla-campos.json")) || [];
        campos = plantilla.map((p: any) => ({ etiqueta: p.etiqueta, obligatorio: p.obligatorio }));
      }
      const soportes = loadJson(path.join(casoDir, "soportes-exigidos.json")) || [];
      const data = {
        pais: sol.pais,
        cliente: sol.cliente,
        formato: fmt,
        campos,
        soportes,
        asunto: sol.asunto,
        fecha: sol.fecha,
        cuerpo: sol.cuerpo,
      };
      logTool(args.caso, "leer_solicitud", true, { caso: args.caso });
      return JSON.stringify({ ok: true, data });
    } catch (e: any) {
      logTool(args.caso, "leer_solicitud", false, e.message);
      return JSON.stringify({ ok: false, error: e.message });
    }
  },
};

export const mapear_campos = {
  description: "Cruza los campos solicitados con el repositorio maestro usando el glosario.",
  args: z.object({
    caso: z.string(),
    campos: z.array(z.any()),
  }),
  async execute(args: { caso: string; campos: any[] }, ctx: any) {
    try {
      const leido = JSON.parse(await leer_solicitud.execute({ caso: args.caso }, ctx));
      if (!leido.ok) return JSON.stringify(leido);
      const pais = leido.data.pais;
      const master = maestro();
      const glo = glosario();
      const llenos: any[] = [];
      const faltantes: any[] = [];
      const requiere_confirmacion: any[] = [];
      for (const c of args.campos) {
        const etiqueta = c?.etiqueta ?? String(c);
        const [clave, score] = buscarMejorEtiqueta(etiqueta, glo);
        if (!clave) {
          faltantes.push({ etiqueta, motivo: "Sin mapeo" });
          continue;
        }
        const valor = getNested(master, clave);
        if (valor == null) {
          faltantes.push({ etiqueta, clave, motivo: "Dato no existe en maestro" });
          continue;
        }
        const notas: string[] = [];
        let requiere = false;
        if (clave === "nit" && pais !== "CO") {
          requiere = true;
          notas.push(`Identificador extranjero (${pais}); se usó el NIT del maestro. Requiere confirmación.`);
        }
        if (score >= 0.7 && score < 0.95) {
          requiere = true;
          notas.push("Mapeo por similitud parcial; requiere confirmación.");
        }
        const item: any = {
          etiqueta,
          clave,
          valor: formatValue(clave, valor),
          ruta: `maestro.${clave}`,
          hoja: c?.hoja,
          celda_etiqueta: c?.celda_etiqueta,
          celda_valor: c?.celda_valor,
          obligatorio: c?.obligatorio,
        };
        if (requiere) {
          item.nota = notas.join(" ");
          requiere_confirmacion.push(item);
        }
        llenos.push(item);
      }
      const data = { llenos, faltantes, requiere_confirmacion };
      logTool(args.caso, "mapear_campos", true, { llenos: llenos.length, faltantes: faltantes.length, requiere: requiere_confirmacion.length });
      return JSON.stringify({ ok: true, data });
    } catch (e: any) {
      logTool(args.caso, "mapear_campos", false, e.message);
      return JSON.stringify({ ok: false, error: e.message });
    }
  },
};

export const generar_formulario = {
  description: "Genera el formulario lleno en xlsx, pdf o valores para portal.",
  args: z.object({
    caso: z.string(),
    mapeo: z.any(),
  }),
  async execute(args: { caso: string; mapeo: any }, ctx: any) {
    try {
      const leido = JSON.parse(await leer_solicitud.execute({ caso: args.caso }, ctx));
      if (!leido.ok) return JSON.stringify(leido);
      const fmt = leido.data.formato;
      const outDir = path.join(OUT, args.caso);
      fs.mkdirSync(outDir, { recursive: true });
      const llenos = args.mapeo?.llenos || [];
      if (fmt === "xlsx") {
        const wb = XLSX.utils.book_new();
        const sheets: Record<string, any> = {};
        for (const item of llenos) {
          const hoja = item.hoja || "Datos";
          if (!sheets[hoja]) {
            sheets[hoja] = XLSX.utils.aoa_to_sheet([[]]);
            XLSX.utils.book_append_sheet(wb, sheets[hoja], hoja);
          }
          const ws = sheets[hoja];
          if (item.celda_etiqueta) ws[item.celda_etiqueta] = { t: "s", v: item.etiqueta };
          if (item.celda_valor) ws[item.celda_valor] = { t: "s", v: item.valor };
        }
        const ruta = path.join(outDir, "formulario.xlsx");
        XLSX.writeFile(wb, ruta);
        logTool(args.caso, "generar_formulario", true, { ruta, formato: "xlsx" });
        return JSON.stringify({ ok: true, data: { ruta, formato: "xlsx" } });
      } else if (fmt === "pdf") {
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        let y = height - 40;
        page.drawText(sanitize(`Formulario - ${args.caso}`), { x: 30, y, size: 12, font });
        y -= 20;
        for (const item of llenos) {
          const line = sanitize(`${item.etiqueta}: ${item.valor}`);
          page.drawText(line, { x: 30, y, size: 10, font });
          y -= 18;
        }
        const ruta = path.join(outDir, "formulario.pdf");
        fs.writeFileSync(ruta, await pdfDoc.save());
        logTool(args.caso, "generar_formulario", true, { ruta, formato: "pdf" });
        return JSON.stringify({ ok: true, data: { ruta, formato: "pdf" } });
      } else if (fmt === "portal") {
        const ruta = path.join(outDir, "valores-portal.md");
        let md = `# Valores para portal - ${args.caso}\n\n`;
        for (const item of llenos) md += `- ${item.etiqueta}: ${item.valor}\n`;
        if (args.mapeo?.faltantes?.length) {
          md += "\n## Faltantes\n";
          for (const f of args.mapeo.faltantes) md += `- ${f.etiqueta}\n`;
        }
        md += "\n## Nota\n";
        md += "Formato portal: el humano debe ingresar las credenciales y cargar los valores manualmente.";
        fs.writeFileSync(ruta, md);
        logTool(args.caso, "generar_formulario", true, { ruta, formato: "portal" });
        return JSON.stringify({ ok: true, data: { ruta, formato: "portal" } });
      }
      return JSON.stringify({ ok: false, error: `Formato no soportado: ${fmt}` });
    } catch (e: any) {
      logTool(args.caso, "generar_formulario", false, e.message);
      return JSON.stringify({ ok: false, error: e.message });
    }
  },
};

export const armar_paquete = {
  description: "Arma el paquete para firma con soportes, checklist y borrador de correo.",
  args: z.object({
    caso: z.string(),
  }),
  async execute(args: { caso: string }, ctx: any) {
    try {
      const leido = JSON.parse(await leer_solicitud.execute({ caso: args.caso }, ctx));
      if (!leido.ok) return JSON.stringify(leido);
      const info = leido.data;
      const mapeoRes = JSON.parse(await mapear_campos.execute({ caso: args.caso, campos: info.campos }, ctx));
      if (!mapeoRes.ok) return JSON.stringify(mapeoRes);
      const mapeo = mapeoRes.data;
      const formRes = JSON.parse(await generar_formulario.execute({ caso: args.caso, mapeo }, ctx));
      if (!formRes.ok) return JSON.stringify(formRes);
      const exigidos = new Set<string>(info.soportes || []);
      const soportesRepo: any[] = loadJson(path.join(SOPORTES, "index.json")) || [];
      const hoy = today();
      const paqueteDir = path.join(OUT, args.caso, "paquete");
      fs.mkdirSync(paqueteDir, { recursive: true });
      const presentes: any[] = [];
      const ausentes: any[] = [];
      const vencidos: any[] = [];
      for (const req of exigidos) {
        const found = soportesRepo.find((s) => s.tipo === req);
        if (!found) {
          ausentes.push({ tipo: req, motivo: "No existe en repositorio" });
          continue;
        }
        let vencido = false;
        if (found.vigencia_hasta && found.vigencia_hasta < hoy) vencido = true;
        const src = path.join(SOPORTES, found.archivo);
        if (!fs.existsSync(src)) {
          ausentes.push({ tipo: req, motivo: `Archivo no encontrado: ${found.archivo}` });
          continue;
        }
        const dst = path.join(paqueteDir, found.archivo);
        fs.copyFileSync(src, dst);
        if (vencido) {
          vencidos.push({ tipo: req, archivo: found.archivo, vigencia_hasta: found.vigencia_hasta });
        } else {
          presentes.push({ tipo: req, archivo: found.archivo });
        }
      }
      const formPath = formRes.data.ruta;
      if (fs.existsSync(formPath)) fs.copyFileSync(formPath, path.join(paqueteDir, path.basename(formPath)));
      const listo = ausentes.length === 0 && vencidos.length === 0;
      fs.writeFileSync(path.join(paqueteDir, "borrador-correo.md"), crearBorrador(args.caso, info, mapeo, presentes, ausentes, vencidos, listo));
      fs.writeFileSync(path.join(paqueteDir, "checklist.md"), crearChecklist(args.caso, info, mapeo, presentes, ausentes, vencidos, listo));
      const data = { ruta: paqueteDir, listo_para_firma: listo, checklist: { presentes, ausentes, vencidos } };
      logTool(args.caso, "armar_paquete", true, data);
      return JSON.stringify({ ok: true, data });
    } catch (e: any) {
      logTool(args.caso, "armar_paquete", false, e.message);
      return JSON.stringify({ ok: false, error: e.message });
    }
  },
};

export const simular_envio = {
  description: "Simula el envío del paquete al cliente tras confirmación humana.",
  args: z.object({
    caso: z.string(),
    confirmado: z.boolean(),
  }),
  async execute(args: { caso: string; confirmado: boolean }, ctx: any) {
    try {
      if (!args.confirmado) {
        logTool(args.caso, "simular_envio", false, "Requiere confirmación");
        return JSON.stringify({ ok: false, error: "Requiere confirmación explícita" });
      }
      const outDir = path.join(OUT, args.caso);
      fs.mkdirSync(outDir, { recursive: true });
      const ruta = path.join(outDir, "ENVIO-SIMULADO.md");
      const contenido = `# Envío simulado - ${args.caso}\n\nEste envío fue simulado por el agente. No se envió ningún correo real.\nPaquete listo en: ${path.join(outDir, "paquete")}\n`;
      fs.writeFileSync(ruta, contenido);
      logTool(args.caso, "simular_envio", true, { ruta });
      return JSON.stringify({ ok: true, data: { ruta, confirmado: true } });
    } catch (e: any) {
      logTool(args.caso, "simular_envio", false, e.message);
      return JSON.stringify({ ok: false, error: e.message });
    }
  },
};
