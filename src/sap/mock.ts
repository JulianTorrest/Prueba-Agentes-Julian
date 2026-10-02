import * as fs from "fs";
import * as path from "path";
import type { SapAdapter, OrdenCompra } from "./adapter.js";

const ROOT = process.cwd();
const FIXTURES = path.resolve(ROOT, "../Retos/reto-03/fixtures/reto-03");
const SAP_OUT = path.resolve(ROOT, "out/sap");
const ORDENES = path.join(SAP_OUT, "ordenes.jsonl");

function ensure() {
  fs.mkdirSync(SAP_OUT, { recursive: true });
  if (!fs.existsSync(ORDENES)) fs.writeFileSync(ORDENES, "");
}

export const mockSap: SapAdapter = {
  async consultarProveedor(nit: string) {
    const provs = JSON.parse(fs.readFileSync(path.join(FIXTURES, "maestros/proveedores.json"), "utf-8"));
    const nitClean = (nit || "").replace(/[.\-]/g, "");
    const p = provs.find((x: any) => x.nit === nitClean);
    if (!p) return null;
    return { codigo_sap: p.codigo_sap, activo: p.activo };
  },
  async crearOrden(orden: OrdenCompra) {
    ensure();
    const existing = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id);
    if (existing) return { numero_oc: existing.numero_oc, fecha: new Date().toISOString().split("T")[0] };
    const lineas = fs.readFileSync(ORDENES, "utf-8").split("\n").filter(Boolean);
    const numero = 4500000001 + lineas.length;
    const reg = { numero_oc: String(numero), fecha: new Date().toISOString().split("T")[0], orden };
    fs.appendFileSync(ORDENES, JSON.stringify(reg) + "\n");
    return { numero_oc: String(numero), fecha: reg.fecha };
  },
  async buscarOrdenPorReferencia(solicitud_id: string) {
    ensure();
    const lineas = fs.readFileSync(ORDENES, "utf-8").split("\n").filter(Boolean);
    for (const l of lineas) {
      const r = JSON.parse(l);
      if (r.orden?.referencia?.solicitud_id === solicitud_id) return { numero_oc: r.numero_oc };
    }
    return null;
  },
};
