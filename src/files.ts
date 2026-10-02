// Listado de artefactos generados en out/ y estadísticas por agente.
import * as fs from "fs";
import * as path from "path";

const OUT = path.join(process.cwd(), "out");

export interface FileEntry {
  path: string; // relativo a out/, separador /
  size: number;
  mtime: string;
}

export function listFiles(): FileEntry[] {
  const out: FileEntry[] = [];
  if (!fs.existsSync(OUT)) return out;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const st = fs.statSync(full);
        out.push({
          path: path.relative(OUT, full).split(path.sep).join("/"),
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      }
    }
  };
  walk(OUT);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const PREVIEWABLE = new Set([".md", ".txt", ".json", ".jsonl", ".csv", ".log"]);

export function readFileSafe(rel: string): { content: string } | null {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.includes("..")) return null;
  const full = path.join(OUT, clean);
  if (!full.startsWith(OUT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  if (!PREVIEWABLE.has(path.extname(full).toLowerCase())) return null;
  return { content: fs.readFileSync(full, "utf-8").slice(0, 20000) };
}

function countLines(file: string): number {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim()).length;
}

export function stats(): any {
  const files = listFiles();
  const totalBytes = files.reduce((a, f) => a + f.size, 0);

  // proveedor: carpetas de caso con paquete/ (excluye sap/, sharepoint/, sol-*)
  const provCasos = [
    ...new Set(
      files.map((f) => f.path.split("/")[0]).filter((top) => !["sap", "sharepoint"].includes(top) && !/^sol-\d+$/i.test(top))
    ),
  ].filter((c) => files.some((f) => f.path.startsWith(`${c}/paquete/`)));

  // contratos
  const maestro = path.join(OUT, "sharepoint", "maestro-contratos.csv");
  const contratosArchivados = files.filter((f) => f.path.startsWith("sharepoint/Contratos/")).length;
  let procesados = 0;
  const procFile = path.join(OUT, "procesados.json");
  if (fs.existsSync(procFile)) {
    try { procesados = Object.keys(JSON.parse(fs.readFileSync(procFile, "utf-8"))).length; } catch {}
  }

  // oc
  const ordenes = files.filter((f) => f.path === "sap/ordenes.jsonl");
  const ocCasos = [...new Set(files.map((f) => f.path.split("/")[0]).filter((t) => /^sol-\d+$/i.test(t)))];
  const controlFile = path.join(OUT, "control.csv");
  const controlRows = fs.existsSync(controlFile)
    ? fs
        .readFileSync(controlFile, "utf-8")
        .split("\n")
        .slice(1)
        .filter((l) => l.trim())
    : [];

  return {
    generado_en: new Date().toISOString(),
    totales: { archivos: files.length, bytes: totalBytes },
    proveedor: {
      casos_procesados: provCasos,
      formularios: files.filter((f) => /formulario.*\.xlsx$/i.test(f.path) && provCasos.includes(f.path.split("/")[0])).length,
      paquetes_completos: files.filter((f) => /\/paquete\/checklist\.md$/i.test(f.path)).length,
      envios_simulados: files.filter((f) => /ENVIO-SIMULADO\.md$/i.test(f.path)).length,
    },
    contratos: {
      mensajes_procesados: procesados,
      contratos_en_maestro: Math.max(0, countLines(maestro) - 1),
      contratos_archivados: contratosArchivados,
      eventos_historial: countLines(path.join(OUT, "sharepoint", "historial.jsonl")),
      alertas_generadas: files.some((f) => f.path === "alertas.md"),
    },
    oc: {
      solicitudes_procesadas: ocCasos,
      ordenes_creadas: ordenes.length ? countLines(path.join(OUT, "sap", "ordenes.jsonl")) : 0,
      filas_control: controlRows.length,
      bloqueadas: controlRows.filter((r) => /bloqueada/i.test(r)).length,
      evidencias_pdf: files.filter((f) => /\.pdf$/i.test(f.path)).length,
    },
    auditoria: { log_global: countLines(path.join(OUT, "log.jsonl")) },
  };
}
