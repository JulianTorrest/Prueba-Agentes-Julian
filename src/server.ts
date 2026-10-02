import "dotenv/config";
import express, { Request, Response } from "express";
import * as path from "path";
import { randomUUID } from "crypto";
import { processMessage } from "./agent.js";
import { ARCHITECTURE, WORKFLOWS } from "./architecture.js";
import { listFiles, readFileSafe, stats } from "./files.js";

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Los artefactos generados en out/ se sirven directamente para descarga/preview
app.use("/out", express.static(path.join(ROOT, "out")));
app.use(express.static(PUBLIC));

const sessions: Record<string, any> = {};

app.post("/api/chat", async (req: Request, res: Response) => {
  const { sessionId, role = "proveedor", message } = req.body || {};
  if (!message) return res.status(400).json({ error: "message requerido" });
  const key = `${role}:${sessionId || "default"}`;
  if (!sessions[key]) sessions[key] = { id: key, role, messages: [], pendingCase: null, pending: null };
  try {
    const result = await processMessage(message, sessions[key], role);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sessions/:role/:id", (req: Request, res: Response) => {
  const s = sessions[`${req.params.role}:${req.params.id}`];
  if (!s) return res.status(404).json({ error: "Sesión no encontrada" });
  res.json(s);
});

app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    ok: true,
    provider: process.env.LLM_PROVIDER || "mistral",
    model: process.env.LLM_MODEL || "open-mistral-nemo",
    llm_offline: process.env.LLM_OFFLINE === "1",
    roles: ["proveedor", "contratos", "oc"],
    uptime_s: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
});

app.get("/api/architecture", (req: Request, res: Response) => {
  res.json({
    ...ARCHITECTURE,
    ciclo_agente: [
      "classify() — reglas deterministas primero; si es ambiguo, JSON de intención al LLM",
      "pipeline de tools zod — única fuente de valores",
      "confirmación humana si la herramienta exige revisión (needsConfirmation)",
      "summarize() — el LLM redacta la respuesta a partir del log de tools",
    ],
    verificacion: "npm run test ejecuta preguntas automatizadas por cada chat",
  });
});

app.get("/api/workflow/:role", (req: Request, res: Response) => {
  const wf = WORKFLOWS[req.params.role];
  if (!wf) return res.status(404).json({ error: "Rol sin workflow" });
  res.json(wf);
});

// ---------- Archivos generados (out/) y estadísticas por agente ----------
app.get("/api/files", (req: Request, res: Response) => {
  res.json({ base: "out/", archivos: listFiles() });
});

app.get("/api/files/content", (req: Request, res: Response) => {
  const p = String(req.query.p || "");
  const f = readFileSafe(p);
  if (!f) return res.status(404).json({ error: "No existe o no es previsualizable (usa /out/<ruta> para descargar)" });
  res.json({ path: p, ...f });
});

app.get("/api/stats", (req: Request, res: Response) => {
  res.json(stats());
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
