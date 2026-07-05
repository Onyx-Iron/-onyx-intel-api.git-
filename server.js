// Onyx Intel (personal) — local server.
// Upload plans, ingest them (text + AI vision), ask questions cited to pages.

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  filePath,
  readPageText,
  getConfig,
  saveConfig,
  clearConfig,
  getTakeoff,
  saveTakeoff,
  getDocParsed,
  clearDocParsed,
  DATA as STORE_DATA,
  PAGES as STORE_PAGES,
  RASTERS as STORE_RASTERS,
} from "./lib/store.js";
import { ingestDocument, retrievePages } from "./lib/ingest.js";
import { answerQuestion, answerTakeoffQuestion, hasKey, aiStatus, testConnection, extractDocumentIntelligence } from "./lib/llm.js";
import { ping, chatJSON, PROVIDERS, PROVIDERS as PROV_MAP } from "./lib/providers.js";
import { renderPage } from "./lib/raster.js";
import { autoTakeoff, autoTakeoffChunked, extractPlanContacts } from "./lib/vision-takeoff.js";
import { listDocs, getDoc, createDoc, updateDoc, deleteDoc } from "./lib/doc-store.js";
import {
  listProjects, getProject, createProject, updateProject, deleteProject,
  addPlanToProject, removePlanFromProject,
  addQnaEntry, getQnaHistory, addKnowledgeFacts, upsertDocumentSummary, getProjectContext,
} from "./lib/project-store.js";
import { runAgent } from "./lib/agent.js";
import { computeCPM, buildGanttData } from "./lib/cpm.js";
import { getAllAgents, getAgent } from "./lib/agents/index.js";
import { CHATBOT_TOOLS, executeChatbotTool } from "./lib/chatbot-tools.js";
import {
  getWebsiteSettings, saveWebsiteSettings, savePage, getPage, listPages, deletePage,
  generateLlmsTxt, generateSchemaOrg, exportSiteFiles,
} from "./lib/website.js";
import {
  getIntegrations, saveProviderConfig, patchProviderConfig, removeProviderConfig,
  setActiveProvider, getActiveConfig, getStorage, saveStorage,
  savePendingOAuth, getPendingOAuth, clearPendingOAuth,
  getGoogleTokens, clearGoogleTokens,
  getConnectors, saveConnector, removeConnector, getConnector,
  getMSTokens, saveMSTokens, clearMSTokens, savePendingMSOAuth, getPendingMSOAuth, clearPendingMSOAuth,
  getQBTokens, saveQBTokens, clearQBTokens, savePendingQBOAuth, getPendingQBOAuth, clearPendingQBOAuth,
} from "./lib/integrations.js";
import {
  searchWeb, searchBrave, getWeather,
  sendSlack, sendSMS, triggerZapier,
  getMSAuthUrl, exchangeMSCode, refreshMSToken,
  msListFiles, msListEmails, msSendEmail, msListCalendar,
  getQBAuthUrl, exchangeQBCode, qbGetInvoices, qbGetExpenses, qbGetPL,
} from "./lib/connectors.js";
import {
  getAuthUrl, exchangeCode, getAuthenticatedClient,
  driveListFiles, driveUploadFile, driveDownloadFile,
  driveGetOrCreateFolder, driveGetQuota, REDIRECT_URI,
  gmailListRecent, gmailSearchMessages, gmailGetMessage, gmailCreateDraft,
  contactsList, contactsSearch,
} from "./lib/google-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

let counter = 0;
function newId() {
  counter += 1;
  return `doc_${Date.now().toString(36)}_${counter}`;
}

// --- health / config ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", aiEnabled: hasKey() });
});

// --- AI settings (provider + key, entered in the app) ---
app.get("/api/settings", (req, res) => {
  res.json(aiStatus());
});

app.post("/api/settings", async (req, res) => {
  const { provider, apiKey, model } = req.body || {};
  if (!provider || !PROVIDERS[provider]) {
    return res.status(400).json({ error: "Choose a valid provider." });
  }
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ error: "API key is required." });
  }
  const cfg = {
    provider,
    apiKey: apiKey.trim(),
    model: (model || "").trim() || PROVIDERS[provider].defaultModel,
  };
  const test = await testConnection(cfg);
  saveConfig(cfg);
  res.json({ ...aiStatus(), test });
});

app.post("/api/settings/test", async (req, res) => {
  const { provider, apiKey, model } = req.body || {};
  const cfg = provider && apiKey ? { provider, apiKey, model } : getConfig();
  res.json(await testConnection(cfg));
});

app.delete("/api/settings", (req, res) => {
  clearConfig();
  res.json(aiStatus());
});

// --- re-run ingestion ---
app.post("/api/documents/:id/reprocess", (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  clearDocParsed(req.params.id); // invalidate stale intelligence cache
  ingestDocument(req.params.id).catch((e) => console.error("reprocess error:", e));
  res.json({ success: true });
});

// --- list documents ---
app.get("/api/documents", (req, res) => {
  res.json({ documents: listDocuments(), aiEnabled: hasKey() });
});

// --- upload + kick off ingestion ---
app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file provided" });
  if (!/\.pdf$/i.test(req.file.originalname) && req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Please upload a PDF" });
  }

  const id = newId();
  fs.writeFileSync(filePath(id), req.file.buffer);
  createDocument({
    id,
    fileName: req.file.originalname,
    sizeBytes: req.file.size,
    status: "queued",
    pageCount: null,
    processedPages: 0,
    pages: [],
    createdAt: new Date().toISOString(),
  });

  ingestDocument(id).catch((e) => console.error("ingest error:", e));
  res.json({ success: true, id });
});

// --- serve the original PDF (for the in-browser viewer, supports #page=N) ---
app.get("/api/documents/:id/file", (req, res) => {
  const p = filePath(req.params.id);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  fs.createReadStream(p).pipe(res);
});

// --- document detail ---
app.get("/api/documents/:id", (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json({ document: d });
});

// --- cancel / delete a document ---
app.delete("/api/documents/:id", (req, res) => {
  const id = req.params.id;
  const doc = getDocument(id);
  if (!doc) return res.status(404).json({ error: "Not found" });

  // Mark cancelled first so any running ingest won't restart it on next server start
  updateDocument(id, { status: "cancelled" });

  // Remove physical files (ignore errors if files already missing)
  try { fs.unlinkSync(filePath(id)); } catch {}
  try { fs.rmSync(path.join(STORE_PAGES, id), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(STORE_RASTERS, id), { recursive: true, force: true }); } catch {}

  // Remove from db and clear intelligence cache
  deleteDocument(id);
  clearDocParsed(id);

  // Unlink from any projects that reference it
  for (const proj of listProjects()) {
    if ((proj.planIds || []).includes(id)) {
      removePlanFromProject(proj.id, id);
    }
  }

  res.json({ success: true });
});

// --- rendered page raster (for the takeoff canvas) ---
app.get("/api/documents/:id/page/:n/raster.png", async (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).end();
  const n = parseInt(req.params.n, 10);
  if (!n || n < 1 || (d.pageCount && n > d.pageCount)) return res.status(404).end();
  try {
    const p = await renderPage(req.params.id, n);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(p).pipe(res);
  } catch (e) {
    console.error("raster error:", e);
    res.status(500).end();
  }
});

// --- auto takeoff (chunked SSE stream) ---
app.post("/api/documents/:id/page/:n/auto-takeoff", async (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  const cfg = getActiveConfig() || getConfig();
  if (!cfg) return res.status(400).json({ error: "No AI provider configured. Add your API key in Settings (⚙)." });
  const n = parseInt(req.params.n, 10);
  if (!n || n < 1) return res.status(400).json({ error: "Invalid page" });

  const { projectId } = req.body || {};

  // SSE streaming response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const rasterPath = await renderPage(req.params.id, n);

    const result = await autoTakeoffChunked(cfg, rasterPath, (ev) => {
      // After each pass, persist items to the document's takeoff
      if (ev.type === "pass_done" && ev.items.length > 0) {
        try {
          const existing = getTakeoff(req.params.id);
          existing.items = existing.items || [];
          // Merge new items (don't add duplicates by label+type on same page)
          const newItems = ev.items.map(it => ({
            _ai: true,
            type: it.type,
            label: it.label,
            unit: it.unit,
            points: it.points,
            depth_ft: it.depth_ft || null,
            material: it.material || null,
            notes: it.notes || "",
            page: n,
          }));
          existing.items.push(...newItems);
          saveTakeoff(req.params.id, existing);
        } catch (e) {
          console.warn("takeoff save error:", e.message);
        }
      }
      // Auto-save extracted contacts from title block to the address book
      if (ev.type === "contacts_done" && ev.contacts?.length) {
        try {
          const existing = loadAppContacts();
          const existingEmails = new Set(existing.map(c => (c.email || "").toLowerCase()).filter(Boolean));
          let added = 0;
          for (const c of ev.contacts) {
            if (c.email && existingEmails.has(c.email.toLowerCase())) continue;
            existing.push({
              id: "ct_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
              ...c,
              projects: projectId ? [projectId] : [],
              source: "plan:" + (d.fileName || req.params.id),
              createdAt: new Date().toISOString(),
            });
            if (c.email) existingEmails.add(c.email.toLowerCase());
            added++;
          }
          if (added > 0) saveAppContacts(existing);
        } catch (e) {
          console.warn("contacts save error:", e.message);
        }
      }
      send(ev);
    });

    // Save analysis report to project
    if (projectId && result.analysis) {
      try {
        const proj = getProject(projectId);
        const reports = proj?.takeoffReports || [];
        reports.unshift({
          id: `rpt_${Date.now()}`,
          docId: req.params.id,
          docName: d.fileName || d.name,
          page: n,
          sheet: result.sheet,
          scale: result.scale,
          itemCount: result.items.length,
          analysis: result.analysis,
          createdAt: new Date().toISOString(),
        });
        updateProject(projectId, { takeoffReports: reports.slice(0, 20) });
      } catch (e) {
        console.warn("report save error:", e.message);
      }
    }

    // Also save analysis to the document itself
    try {
      const existing = getTakeoff(req.params.id);
      existing.lastAnalysis = result.analysis;
      existing.lastAnalysisAt = new Date().toISOString();
      saveTakeoff(req.params.id, existing);
    } catch {}

  } catch (e) {
    console.error("auto-takeoff error:", e);
    send({ type: "error", error: "Auto takeoff failed: " + (e.message || String(e)) });
  }

  if (!res.writableEnded) res.end();
});

// --- takeoff: load / save measured items + per-sheet calibration ---
app.get("/api/documents/:id/takeoff", (req, res) => {
  if (!getDocument(req.params.id)) return res.status(404).json({ error: "Not found" });
  res.json({ takeoff: getTakeoff(req.params.id) });
});

app.put("/api/documents/:id/takeoff", (req, res) => {
  if (!getDocument(req.params.id)) return res.status(404).json({ error: "Not found" });
  const t = req.body && req.body.takeoff ? req.body.takeoff : req.body;
  const takeoff = {
    calibrations: t.calibrations || {},
    items: Array.isArray(t.items) ? t.items : [],
  };
  saveTakeoff(req.params.id, takeoff);
  res.json({ success: true, takeoff });
});

// ── Geo Calibration — store transform + control points on the document ──
app.get("/api/documents/:id/geocalib", (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json(d.geoCalib || null);
});

app.put("/api/documents/:id/geocalib", (req, res) => {
  if (!getDocument(req.params.id)) return res.status(404).json({ error: "Not found" });
  const { crs, pts, calib } = req.body || {};
  updateDocument(req.params.id, { geoCalib: { crs: crs || "local", pts: pts || [], calib: calib || null, updatedAt: new Date().toISOString() } });
  res.json({ ok: true });
});

app.delete("/api/documents/:id/geocalib", (req, res) => {
  if (!getDocument(req.params.id)) return res.status(404).json({ error: "Not found" });
  updateDocument(req.params.id, { geoCalib: null });
  res.json({ ok: true });
});

// ── GeoJSON export — takeoff items in world coordinates ──────
app.get("/api/documents/:id/geojson", (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).end();
  const gc = d.geoCalib;
  if (!gc?.calib) return res.status(400).json({ error: "No geo calibration on this document." });
  const t = getTakeoff(req.params.id);
  const [r0, r1] = gc.calib.fwd;
  const planToWorld = (x, y) => ({
    x: r0[0]*x + r0[1]*y + r0[2],
    y: r1[0]*x + r1[1]*y + r1[2],
  });
  const features = (t.items || []).filter(it => it.points?.length).map(it => {
    const wpts = it.points.map(p => { const w = planToWorld(p.x, p.y); return [w.x, w.y]; });
    let geometry;
    if (it.type === "count")  geometry = { type: "MultiPoint",  coordinates: wpts };
    else if (it.type === "length") geometry = { type: "LineString", coordinates: wpts };
    else { geometry = { type: "Polygon", coordinates: [[...wpts, wpts[0]]] }; }
    return { type: "Feature", geometry, properties: { id: it.id, label: it.label, type: it.type, qty: it.quantity, unit: it.unit, page: it.page } };
  });
  res.setHeader("Content-Type", "application/geo+json");
  res.setHeader("Content-Disposition", `attachment; filename="takeoff-${req.params.id}.geojson"`);
  res.json({ type: "FeatureCollection", properties: { crs: gc.crs, docId: req.params.id }, features });
});

// --- takeoff CSV export (line-item estimate) ---
app.get("/api/documents/:id/takeoff/export.csv", (req, res) => {
  const d = getDocument(req.params.id);
  if (!d) return res.status(404).end();
  const t = getTakeoff(req.params.id);
  const sheetFor = (pg) => {
    const p = (d.pages || []).find((x) => x.page === pg);
    return p && p.sheet ? p.sheet : "";
  };
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [["Page", "Sheet", "Type", "Label", "Quantity", "Unit", "Rate", "Extended", "Notes", "Provenance"]];
  let total = 0;
  for (const it of t.items || []) {
    const ext = it.rate != null && it.quantity != null ? Number(it.rate) * Number(it.quantity) : "";
    if (ext !== "") total += ext;
    const m = it.meta;
    const notes =
      it.type === "volume" && m
        ? `${m.footprintSF} SF x ${m.depthFt} ft depth${m.swell > 1 ? ` x ${m.swell} swell = ${m.looseCY} CY loose` : ""}`
        : "";
    rows.push([
      it.page, sheetFor(it.page), it.type, it.label ?? "",
      round(it.quantity), it.unit ?? "", it.rate ?? "",
      ext === "" ? "" : round(ext), notes, "MEASURED",
    ]);
  }
  rows.push([]);
  rows.push(["", "", "", "", "", "", "", round(total), "", "TOTAL"]);
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="takeoff-${d.fileName.replace(/\.pdf$/i, "")}.csv"`);
  res.send(csv);
});

// ── Projects ────────────────────────────────────────────────────────
app.get("/api/projects", (req, res) => res.json({ projects: listProjects() }));

app.post("/api/projects", (req, res) => {
  res.json({ project: createProject(req.body || {}) });
});

app.get("/api/projects/:id", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  // enrich with plan objects and doc counts
  const plans = p.planIds.map(pid => {
    const d = getDocument(pid);
    return d ? { id: pid, fileName: d.fileName, status: d.status, pageCount: d.pageCount } : null;
  }).filter(Boolean);
  const docs = listDocs().filter(d => d.projectId === req.params.id);
  res.json({ project: { ...p, plans, docCount: docs.length } });
});

app.put("/api/projects/:id", (req, res) => {
  const p = updateProject(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json({ project: p });
});

app.delete("/api/projects/:id", (req, res) => {
  deleteProject(req.params.id);
  res.json({ success: true });
});

app.post("/api/projects/:id/plans/:planId", (req, res) => {
  addPlanToProject(req.params.id, req.params.planId);
  res.json({ success: true });
});

app.delete("/api/projects/:id/plans/:planId", (req, res) => {
  removePlanFromProject(req.params.id, req.params.planId);
  res.json({ success: true });
});

// ── Schedule Tasks (CPM) ───────────────────────────────────────────────────
function cpmForProject(proj) {
  const tasks = proj.scheduleTasks || [];
  if (!tasks.length) return [];
  const startDate = proj.startDate ? new Date(proj.startDate) : new Date();
  const cpm = computeCPM(tasks);
  return buildGanttData(cpm, startDate);
}

app.get("/api/projects/:id/tasks", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json({ tasks: cpmForProject(p) });
});

app.post("/api/projects/:id/tasks", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const task = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    name: req.body.name || "New Task",
    duration: req.body.duration || 5,
    deps: req.body.deps || [],
    status: req.body.status || "pending",
    meta: req.body.meta || {},
  };
  const tasks = [...(p.scheduleTasks || []), task];
  const updated = updateProject(req.params.id, { scheduleTasks: tasks });
  res.json({ task, tasks: cpmForProject(updated) });
});

app.put("/api/projects/:id/tasks/:tid", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const tasks = (p.scheduleTasks || []).map(t =>
    t.id === req.params.tid ? { ...t, ...req.body, id: t.id } : t
  );
  const updated = updateProject(req.params.id, { scheduleTasks: tasks });
  res.json({ tasks: cpmForProject(updated) });
});

app.delete("/api/projects/:id/tasks/:tid", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const tasks = (p.scheduleTasks || []).filter(t => t.id !== req.params.tid);
  const updated = updateProject(req.params.id, { scheduleTasks: tasks });
  res.json({ tasks: cpmForProject(updated) });
});

// ── Dual-AI config helper ─────────────────────────────────────────
function getComplementaryConfig(primaryCfg) {
  const data = getIntegrations();
  const provs = data.providers || {};
  const pick = (id) => provs[id] ? { provider: id, apiKey: provs[id].apiKey, model: provs[id].model } : null;
  if (primaryCfg?.provider === "anthropic") return pick("openai");
  if (primaryCfg?.provider === "openai") return pick("anthropic");
  return pick("anthropic") || pick("openai");
}

// ── Agent registry ────────────────────────────────────────────────────────────
app.get("/api/agents", (req, res) => {
  res.json({ agents: getAllAgents().map(a => ({ id: a.id, label: a.label, icon: a.icon, core: a.core, description: a.description, color: a.color })) });
});

// ── Public chatbot ────────────────────────────────────────────────────────────
// GET  /api/chatbot/tools   — return tool definitions (for embedding)
// POST /api/chatbot          — conversational endpoint with tool execution
// POST /api/chatbot/tool     — execute a single tool directly (for testing)

app.get("/api/chatbot/tools", (req, res) => {
  res.json({ tools: CHATBOT_TOOLS });
});

app.post("/api/chatbot/tool", (req, res) => {
  const { name, args } = req.body;
  if (!name) return res.status(400).json({ error: "Missing tool name" });
  try {
    const result = executeChatbotTool(name, args || {});
    res.json({ tool: name, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chatbot", async (req, res) => {
  const { messages = [], sessionId } = req.body;
  if (!messages.length) return res.status(400).json({ error: "No messages provided" });

  const cfg = getActiveConfig() || getConfig();
  if (!cfg) return res.status(503).json({ error: "No AI provider configured" });

  // Build system prompt from KB
  let kbBlock = "";
  try {
    const kb = JSON.parse(fs.readFileSync(path.join(__dirname, "data/website/knowledge-base.json"), "utf8")).knowledge_base;
    const f = kb.company_facts;
    kbBlock = `
COMPANY: ${f.name} | ${f.years_in_business} years | ${f.headquarters}
PHONE: ${f.phone} | EMAIL: ${f.email} | WEBSITE: ${f.website}
ADDRESS: ${f.address}
PROJECT RANGE: ${f.project_range} | ON-TIME RATE: ${f.on_time_rate}
WARRANTY: ${f.warranty} | INSURANCE: ${f.insurance}
CERTIFICATIONS: ${f.certifications.join(", ")}
LEAD TIME: ${f.lead_time}
VALUE ENGINEERING SAVINGS: ${f.value_engineering_savings}
BRAND PROMISE: ${f.brand_promise}
PRIMARY SERVICE AREAS: ${kb.service_areas.primary.join(", ")}
EXTENDED SERVICE AREAS: ${kb.service_areas.extended.join(", ")}
SERVICES: ${Object.values(kb.services).map(s => s.label).join(", ")}`;
  } catch { /* use fallback */ }

  const CHATBOT_SYSTEM = `You are the Onyx & Iron Construction AI assistant — a professional, knowledgeable virtual representative for Onyx & Iron Construction, a full-service general contractor based in Dallas, TX.
${kbBlock}

BEHAVIOR:
- Be confident, clear, and direct — let our track record speak
- Never fabricate project details, timelines, or pricing
- For estimates: always direct to phone or contact form — never quote prices
- Route high-intent leads to (945) 365-1245 or https://www.onyx-iron.com/contact
- Use your tools to look up service info, verify service areas, generate CTAs, and qualify leads
- Always respond in plain, accessible language — not corporate jargon

TOOLS AVAILABLE:
- get_service_info(service_type) — detailed info on any service
- check_service_area(city, state) — verify location coverage
- generate_contact_cta(context) — build a context-aware CTA
- qualify_lead(project_type, estimated_budget, timeline, location) — assess and route a lead

Return JSON: { "message": "response to user", "tool_calls": [...], "suggestions": ["..."] }`;

  try {
    const { chatText, repairJSON } = await import("./lib/providers.js");
    const raw = await chatText(cfg, CHATBOT_SYSTEM, messages);
    let result;
    try { result = repairJSON(raw); } catch { result = { message: raw, tool_calls: [], suggestions: [] }; }

    // Execute any tool calls
    const toolResults = [];
    for (const tc of result.tool_calls || []) {
      try {
        const tr = executeChatbotTool(tc.tool, tc.args || {});
        toolResults.push({ tool: tc.tool, args: tc.args, result: tr });
      } catch (e) {
        toolResults.push({ tool: tc.tool, error: e.message });
      }
    }

    res.json({ message: result.message, suggestions: result.suggestions || [], tool_results: toolResults, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Website builder ───────────────────────────────────────────────────────────
app.get("/api/website", (req, res) => {
  res.json({ settings: getWebsiteSettings(), pages: listPages() });
});
app.patch("/api/website/settings", (req, res) => {
  res.json(saveWebsiteSettings(req.body || {}));
});
app.get("/api/website/llmstxt", (req, res) => {
  res.type("text/plain").send(generateLlmsTxt());
});
app.get("/api/website/schema", (req, res) => {
  res.json(generateSchemaOrg());
});
app.get("/api/website/pages", (req, res) => {
  res.json({ pages: listPages() });
});
app.post("/api/website/page", (req, res) => {
  const { name, html, meta } = req.body || {};
  if (!name || !html) return res.status(400).json({ error: "name and html required" });
  res.json(savePage(name, html, meta || {}));
});
app.get("/api/website/page/:name", (req, res) => {
  const page = getPage(req.params.name);
  if (!page) return res.status(404).json({ error: "Page not found" });
  res.json(page);
});
app.delete("/api/website/page/:name", (req, res) => {
  deletePage(req.params.name);
  res.json({ ok: true });
});
app.get("/api/website/export", (req, res) => {
  const files = exportSiteFiles();
  // Return as JSON array of { name, content (base64) }
  res.json({ files: files.map(f => ({ name: f.name, content: f.content.toString("base64") })) });
});
// Serve website pages directly (for live preview)
app.get("/website/:page", (req, res) => {
  const page = getPage(req.params.page);
  if (!page) return res.status(404).send("<h1>Page not found</h1>");
  res.type("text/html").send(page.html);
});
app.get("/website", (req, res) => {
  const page = getPage("home");
  if (!page) return res.status(404).send("<h1>No home page yet. Ask the Marketing Agent to build your website.</h1>");
  res.type("text/html").send(page.html);
});

// ── AI Agent ─────────────────────────────────────────────────────────
app.post("/api/agent", async (req, res) => {
  const { messages, projectId, agentType } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }
  const cfgPrimary = getActiveConfig() || getConfig();
  if (!cfgPrimary) return res.status(400).json({ error: "No AI provider configured. Add an API key in Settings (⚙)." });

  const cfgSecondary = getComplementaryConfig(cfgPrimary);
  const project = projectId ? getProject(projectId) : null;

  try {
    let contextText = "";
    if (project && project.planIds?.length > 0) {
      const lastUserMsg = messages[messages.length - 1]?.content || "";
      const enrichedDocs = project.planIds.map(pid => {
        const d = getDocument(pid);
        return d && (d.status === "ready" || (d.status === "processing" && (d.pages || []).length > 0)) ? {
          id: d.id, fileName: d.fileName, pages: d.pages || [],
          readText: (n) => { try { return readPageText(d.id, n); } catch { return ""; } },
        } : null;
      }).filter(Boolean);
      if (enrichedDocs.length > 0) {
        const relevant = retrievePages(enrichedDocs, lastUserMsg || "construction project overview", 6);
        if (relevant.length > 0) {
          contextText = "\n\nRELEVANT PLAN PAGES FOR THIS QUESTION:\n" +
            relevant.map(p => `--- ${p.documentName} | Pg ${p.page}${p.sheet ? ` (${p.sheet})` : ""} ---\n${(p.text || "").slice(0, 600)}`).join("\n\n");
        }
      }
    }

    const enrichedMessages = messages.map((m, i) =>
      i === messages.length - 1 && m.role === "user" && contextText
        ? { ...m, content: m.content + contextText }
        : m
    );

    const result = await runAgent(cfgPrimary, enrichedMessages, project, cfgSecondary, agentType || "preconstruction");
    res.json(result);
  } catch (e) {
    console.error("agent error:", e);
    res.status(500).json({ error: String(e.message || e), message: "Agent error: " + e.message, tool_calls: [], suggestions: [] });
  }
});

// ── Construction Documents ──────────────────────────────────────────
app.get("/api/cdocs", (req, res) => {
  res.json({ docs: listDocs(req.query.type || null) });
});

app.post("/api/cdocs", (req, res) => {
  const { type, fields, status } = req.body || {};
  if (!type) return res.status(400).json({ error: "type required" });
  res.json({ doc: createDoc({ type, fields: fields || {}, status: status || "draft" }) });
});

app.get("/api/cdocs/:id", (req, res) => {
  const doc = getDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({ doc });
});

app.put("/api/cdocs/:id", (req, res) => {
  const doc = updateDoc(req.params.id, req.body);
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({ doc });
});

app.delete("/api/cdocs/:id", (req, res) => {
  deleteDoc(req.params.id);
  res.json({ success: true });
});

function round(n) {
  if (n == null || n === "") return n;
  return Math.round(Number(n) * 100) / 100;
}

// Parse explicit page numbers/ranges from a question string.
// Returns sorted array of page numbers if found, else null.
function parseRequestedPages(question) {
  const pages = new Set();
  // Match "page(s) / pg(s) / p." followed by numbers, ranges, and separators
  const pagePattern = /(?:pages?|pgs?|p\.)\s*([\d,\s\-–andthroughto]+)/gi;
  let m;
  while ((m = pagePattern.exec(question)) !== null) {
    const chunk = m[1];
    // Expand ranges: "3-10", "3 to 10", "3 through 10"
    const rangeRe = /(\d+)\s*(?:[-–]|to|through)\s*(\d+)/gi;
    let rm;
    while ((rm = rangeRe.exec(chunk)) !== null) {
      const lo = parseInt(rm[1], 10), hi = parseInt(rm[2], 10);
      for (let i = lo; i <= hi && i <= 2000; i++) pages.add(i);
    }
    // Individual numbers
    for (const n of (chunk.match(/\d+/g) || [])) pages.add(parseInt(n, 10));
  }
  return pages.size > 0 ? [...pages].sort((a, b) => a - b) : null;
}

// ── Project knowledge endpoints ───────────────────────────────────
app.get("/api/projects/:id/qna", (req, res) => {
  const history = getQnaHistory(req.params.id, 50);
  res.json({ qna: history });
});

app.post("/api/projects/:id/qna", (req, res) => {
  const { question, answer, citations, type } = req.body || {};
  if (!question) return res.status(400).json({ error: "question required" });
  addQnaEntry(req.params.id, { question, answer, citations, type });
  res.json({ ok: true });
});

app.get("/api/projects/:id/knowledge", (req, res) => {
  const ctx = getProjectContext(req.params.id);
  if (!ctx) return res.status(404).json({ error: "Project not found" });
  res.json({ context: ctx });
});

// --- ask a question ---
app.post("/api/ask", async (req, res) => {
  try {
    const { question, documentId, projectId } = req.body || {};
    if (!question || !question.trim()) {
      return res.status(400).json({ error: "Empty question" });
    }

    let docs = listDocuments().filter((d) =>
      d.status === "ready" || (d.status === "processing" && (d.pages || []).length > 0)
    );
    if (documentId) docs = docs.filter((d) => d.id === documentId);
    if (!docs.length) {
      return res.json({
        found: false,
        answer: "No processed documents to search yet. Upload a plan and wait for it to finish processing.",
        citations: [],
      });
    }

    const enriched = docs.map((meta) => {
      const full = getDocument(meta.id);
      return {
        id: meta.id,
        fileName: meta.fileName,
        pages: full.pages || [],
        readText: (n) => readPageText(meta.id, n),
      };
    });

    // Detect takeoff-type queries — use a smarter page selection strategy
    const TAKEOFF_RE = /take.?off|takeoff|full.*(list|quantity|quantities|spec)|quantity|quantities|material.*spec|spec.*material|how many|square.?f(?:oot|eet|t)?|\bsf\b|\blf\b|\bcy\b|\bea\b|linear.?f|count\s+of|measure|all.*item|complete.*list|bill.of.material/i;
    const isTakeoff = TAKEOFF_RE.test(question);

    // ── Q&A Response Cache ─────────────────────────────────────────
    // For non-takeoff questions, return cached answer if we've answered this before.
    // Normalise: lowercase, strip trailing punctuation, collapse whitespace.
    const normQ = q => q.toLowerCase().trim().replace(/[?!.,;:]+$/, "").replace(/\s+/g, " ");
    if (!isTakeoff && projectId) {
      const history = getQnaHistory(projectId, 100);
      const cached = history.find(e =>
        e.type !== "takeoff" && e.answer && e.answer.length > 10 &&
        normQ(e.question) === normQ(question)
      );
      if (cached) {
        return res.json({
          found: true,
          answer: cached.answer,
          citations: cached.citations || [],
          fromCache: true,
          cachedAt: cached.ts,
          searchedPages: [],
        });
      }
    }

    // ── Build cached intelligence context ─────────────────────────
    // Inject pre-parsed data (sheets, materials, quantities, specs) so the AI
    // reads the cache rather than re-processing every raw page every call.
    const parsedParts = [];
    for (const doc of enriched) {
      const parsed = getDocParsed(doc.id);
      if (!parsed) continue;
      const lines = [];
      if (parsed.projectName) lines.push(`Project: ${parsed.projectName}`);
      if (parsed.architect) lines.push(`Architect: ${parsed.architect}`);
      if (parsed.engineer) lines.push(`Engineer: ${parsed.engineer}`);
      if (parsed.date) lines.push(`Date: ${parsed.date}`);
      if (parsed.sheets?.length) lines.push(`Sheets: ${parsed.sheets.slice(0, 20).map(s => `${s.number} – ${s.title}`).join(", ")}`);
      if (parsed.rooms?.length) lines.push(`Rooms: ${parsed.rooms.slice(0, 15).map(r => `${r.name} (${r.area})`).join(", ")}`);
      if (parsed.materials?.length) lines.push(`Materials: ${parsed.materials.slice(0, 12).join(", ")}`);
      if (parsed.specifications?.length) lines.push(`Specs: ${parsed.specifications.slice(0, 8).join(", ")}`);
      if (parsed.equipment?.length) lines.push(`Equipment: ${parsed.equipment.slice(0, 8).join(", ")}`);
      if (parsed.quantities?.length) lines.push(`Quantities: ${parsed.quantities.slice(0, 12).map(q => `${q.item}: ${q.qty} ${q.unit}`).join(", ")}`);
      if (parsed.notes?.length) lines.push(`Notes: ${parsed.notes.slice(0, 5).join("; ")}`);
      if (lines.length) parsedParts.push(`=== CACHED PARSE: ${doc.fileName} (extracted ${parsed.extractedAt?.slice(0, 10) || "recently"}) ===\n${lines.join("\n")}`);
    }
    const parsedIntelligence = parsedParts.length
      ? "\n\n--- CACHED DOCUMENT INTELLIGENCE (pre-extracted — use this to answer without re-reading pages) ---\n" + parsedParts.join("\n\n") + "\n--- END CACHED DATA ---"
      : "";

    let contextPages;
    let result;

    if (isTakeoff) {
      // For takeoff queries: gather all pages, sorted by priority
      // Priority: calibrated drawing pages > vision/drawing pages > embedded spec pages
      const allContextPages = [];
      for (const doc of enriched) {
        const takeoffData = getTakeoff(doc.id);
        const calibratedNums = new Set(Object.keys(takeoffData.calibrations || {}).map(Number));
        const fullDoc = getDocument(doc.id);
        for (const pg of (fullDoc.pages || [])) {
          const text = doc.readText(pg.page);
          const isDrawing = pg.source === 'vision' || pg.source === 'cached' ||
                            pg.source === 'embedded-sparse' || pg.source === 'image-no-key' ||
                            pg.source === 'image-unread' || pg.chars < 300;
          const calibrated = calibratedNums.has(pg.page);
          // Score: calibrated drawing pages first, then any drawing page, then spec pages
          const priority = calibrated ? 3 : isDrawing ? 2 : 1;
          allContextPages.push({
            documentName: doc.fileName,
            documentId: doc.id,
            page: pg.page,
            sheet: pg.sheet,
            text,
            calibrated,
            isDrawing,
            priority,
          });
        }
      }
      // Sort by priority desc, then page number asc within same priority
      allContextPages.sort((a, b) => b.priority - a.priority || a.page - b.page);

      // If the user specified particular pages ("pages 3, 7, 12" / "pages 1-5"), honour that exactly
      const requestedPages = parseRequestedPages(question);
      if (requestedPages) {
        const wanted = new Set(requestedPages);
        contextPages = allContextPages.filter(p => wanted.has(p.page));
      } else {
        // No specific pages — include ALL pages, no cap
        contextPages = allContextPages;
      }

      // Inject prior takeoff results as context so the AI can build on prior work
      let priorTakeoffContext = "";
      if (projectId) {
        const recentQna = getQnaHistory(projectId, 5);
        const priorTakeoffs = recentQna.filter(e => e.type === "takeoff");
        if (priorTakeoffs.length > 0) {
          priorTakeoffContext = "\n\nPRIOR TAKEOFF RESULTS FOR THIS PROJECT (build on these, do not repeat, extend and correct):\n" +
            priorTakeoffs.map(t => `[${t.ts?.slice(0,10)}] ${t.question}\n${t.answer.slice(0,1000)}`).join("\n---\n");
        }
      }

      result = await answerTakeoffQuestion(question + priorTakeoffContext + parsedIntelligence, contextPages);
    } else {
      contextPages = retrievePages(enriched, question);
      result = await answerQuestion(question + parsedIntelligence, contextPages);
    }

    const byName = new Map(enriched.map((d) => [d.fileName, d.id]));
    result.citations = (result.citations || []).map((c) => ({
      ...c,
      documentId: byName.get(c.document) || (documentId ?? enriched[0]?.id),
    }));

    // Persist Q&A to project so the AI can build on it in future sessions
    if (projectId && result.found) {
      try {
        addQnaEntry(projectId, {
          question,
          answer: result.answer,
          citations: result.citations || [],
          type: isTakeoff ? "takeoff" : "question",
          pageCount: contextPages.length,
          ts: new Date().toISOString(),
        });
        // Extract and save short knowledge facts from the answer
        const factLines = (result.answer || "")
          .split("\n")
          .filter(l => /\d/.test(l) && l.trim().length > 10 && l.trim().length < 200)
          .slice(0, 15)
          .map(l => ({ type: isTakeoff ? "quantity" : "finding", text: l.trim() }));
        if (factLines.length) addKnowledgeFacts(projectId, factLines);
      } catch (e) {
        console.warn("Q&A save warning:", e.message);
      }
    }

    res.json({ ...result, isTakeoff, searchedPages: contextPages.map((c) => ({ document: c.documentName, page: c.page })) });
  } catch (err) {
    console.error("ask error:", err);
    res.status(500).json({ error: "Ask failed", detail: String(err?.message || err) });
  }
});

// ── Integrations ─────────────────────────────────────────────────
// GET all integration status (safe — no keys in response)
app.get("/api/integrations", (req, res) => {
  const data = getIntegrations();
  const providers = {};
  for (const [id, cfg] of Object.entries(data.providers || {})) {
    providers[id] = {
      configured: true,
      model: cfg.model,
      label: PROV_MAP[id]?.label || id,
      updatedAt: cfg.updatedAt,
    };
  }
  const google = data.google ? {
    connected: true,
    email: data.google.email,
    name: data.google.name,
    picture: data.google.picture,
  } : { connected: false };

  const ms = getMSTokens();
  const qb = getQBTokens();
  const connectors = getConnectors();
  const connectorStatus = {};
  for (const [id, cfg] of Object.entries(connectors)) {
    connectorStatus[id] = { configured: true, updatedAt: cfg.updatedAt };
  }

  res.json({
    providers,
    activeProvider: data.activeProvider,
    google,
    microsoft: ms ? { connected: true, email: ms.email, name: ms.name } : { connected: false },
    quickbooks: qb ? { connected: true, realmId: qb.realmId } : { connected: false },
    connectors: connectorStatus,
    storage: data.storage || { type: "local", driveSync: false },
  });
});

// Save provider API key + config
app.post("/api/integrations/providers/:id", async (req, res) => {
  const { id } = req.params;
  const { apiKey, model, setActive } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });
  if (!PROV_MAP[id]) return res.status(400).json({ error: "Unknown provider" });

  // Test connection first
  const cfg = { provider: id, apiKey, model: model || PROV_MAP[id].defaultModel };
  const test = await ping(cfg);
  if (!test.ok) return res.status(400).json({ error: "Connection test failed: " + test.error });

  saveProviderConfig(id, { apiKey, model: cfg.model });
  if (setActive) setActiveProvider(id);

  // Also save to legacy store so existing AI features (Q&A, ingest) still work
  saveConfig(cfg);

  res.json({ ok: true, provider: id, model: cfg.model });
});

// Remove provider
app.delete("/api/integrations/providers/:id", (req, res) => {
  removeProviderConfig(req.params.id);
  res.json({ ok: true });
});

// Set active provider
app.post("/api/integrations/active", (req, res) => {
  const { provider } = req.body || {};
  if (!provider) return res.status(400).json({ error: "provider required" });
  setActiveProvider(provider);
  // Update legacy store
  const data = getIntegrations();
  const cfg = data.providers[provider];
  if (cfg) saveConfig({ provider, apiKey: cfg.apiKey, model: cfg.model });
  res.json({ ok: true, activeProvider: provider });
});

// Update model only (no re-auth)
app.patch("/api/integrations/providers/:id", (req, res) => {
  const { model } = req.body || {};
  if (!model) return res.status(400).json({ error: "model required" });
  patchProviderConfig(req.params.id, { model });
  const data = getIntegrations();
  const cfg = data.providers[req.params.id];
  if (cfg && req.params.id === data.activeProvider) {
    saveConfig({ provider: req.params.id, apiKey: cfg.apiKey, model });
  }
  res.json({ ok: true });
});

// Test a specific provider (uses stored key if none provided)
app.post("/api/integrations/test/:id", async (req, res) => {
  const id = req.params.id;
  const stored = (getIntegrations().providers || {})[id];
  const apiKey = req.body?.apiKey || stored?.apiKey;
  const model = req.body?.model || stored?.model || PROV_MAP[id]?.defaultModel;
  if (!apiKey) return res.status(400).json({ error: "Provider not configured" });
  const result = await ping({ provider: id, apiKey, model });
  res.json(result);
});

// Storage preferences
app.get("/api/integrations/storage", (req, res) => res.json(getStorage()));
app.put("/api/integrations/storage", (req, res) => res.json(saveStorage(req.body || {})));

// ── Google OAuth ──────────────────────────────────────────────────
// Step 1: Generate auth URL
app.post("/api/auth/google/start", (req, res) => {
  let { clientId, clientSecret } = req.body || {};
  // Allow reconnect using stored credentials (scope upgrades, re-auth)
  if (!clientId || !clientSecret) {
    const stored = getGoogleTokens();
    if (stored?.clientId && stored?.clientSecret) {
      clientId = stored.clientId;
      clientSecret = stored.clientSecret;
    } else {
      return res.status(400).json({ error: "clientId and clientSecret required" });
    }
  }
  savePendingOAuth(clientId, clientSecret);
  const url = getAuthUrl(clientId, clientSecret);
  res.json({ url, redirectUri: REDIRECT_URI });
});

// Step 2: OAuth callback (browser is redirected here by Google)
app.get("/api/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2 style="color:#ef4444">Google OAuth Error</h2><p>${error}</p><p><a href="http://localhost:${PORT}" style="color:#ceff00">← Back to Onyx Intel</a></p></div></body></html>`);
  }
  try {
    const pending = getPendingOAuth();
    if (!pending) throw new Error("No pending OAuth session. Start the flow again.");
    await exchangeCode(code, pending.clientId, pending.clientSecret);
    clearPendingOAuth();
    res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2 style="color:#ceff00">✓ Google Account Connected!</h2><p>You can close this tab and return to Onyx Intel.</p><script>setTimeout(()=>window.close(),2000)</script></div></body></html>`);
  } catch (e) {
    console.error("OAuth callback error:", e);
    res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px"><h2 style="color:#ef4444">Error</h2><pre>${e.message}</pre><a href="http://localhost:${PORT}" style="color:#ceff00">← Back</a></body></html>`);
  }
});

// Disconnect Google
app.delete("/api/auth/google", (req, res) => {
  clearGoogleTokens();
  res.json({ ok: true });
});

// ── Google Drive ──────────────────────────────────────────────────
app.get("/api/drive/files", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  try {
    const files = await driveListFiles(auth, req.query.folderId || null);
    res.json({ files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/drive/quota", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  try {
    const about = await driveGetQuota(auth);
    res.json({ quota: about.storageQuota, user: about.user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload current plan PDF to Drive
app.post("/api/drive/upload/:docId", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  const doc = getDocument(req.params.docId);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  try {
    const folderId = await driveGetOrCreateFolder(auth, "Onyx Intel Plans");
    const buf = fs.readFileSync(filePath(req.params.docId));
    const file = await driveUploadFile(auth, doc.fileName, buf, "application/pdf", folderId);
    res.json({ ok: true, file });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Gmail ─────────────────────────────────────────────────────────
app.get("/api/gmail/recent", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  try { res.json({ messages: await gmailListRecent(auth, 25) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/gmail/search", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  try { res.json({ messages: await gmailSearchMessages(auth, req.query.q || "", 20) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/gmail/:id", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  try { res.json(await gmailGetMessage(auth, req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/gmail/draft", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  const { to, subject, body, cc } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: "to and subject required" });
  try { res.json(await gmailCreateDraft(auth, { to, subject, body: body || "", cc })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Contacts ──────────────────────────────────────────────────────
app.get("/api/contacts", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  try {
    const q = req.query.q;
    const list = q ? await contactsSearch(auth, q) : await contactsList(auth);
    res.json({ contacts: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sync Google contacts into current project
app.post("/api/projects/:id/sync-contacts", async (req, res) => {
  const auth = await getAuthenticatedClient();
  if (!auth) return res.status(401).json({ error: "Google not connected" });
  const proj = getProject(req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  try {
    const googleContacts = await contactsList(auth);
    const existing = proj.contacts || [];
    const existingEmails = new Set(existing.map(c => c.email).filter(Boolean));
    const newOnes = googleContacts.filter(c => c.email && !existingEmails.has(c.email))
      .map(c => ({ name: c.name, email: c.email, phone: c.phone, company: c.company, title: c.title, source: "google" }));
    const merged = [...existing, ...newOnes];
    updateProject(req.params.id, { contacts: merged });
    res.json({ added: newOnes.length, total: merged.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Company / Website context ─────────────────────────────────────
const COMPANY_CTX_FILE = path.join(STORE_DATA, "company-context.json");

app.post("/api/company/sync-website", async (req, res) => {
  const urls = [
    "https://www.onyx-iron.com",
    "https://www.onyx-iron.com/about",
    "https://www.onyx-iron.com/services",
    "https://www.onyx-iron.com/contact",
  ];

  function stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractField(text, ...patterns) {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1]?.trim();
    }
    return "";
  }

  try {
    const texts = [];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "OnyxIntelBot/1.0" }, signal: AbortSignal.timeout(8000) });
        if (r.ok) texts.push(stripHtml(await r.text()).slice(0, 3000));
      } catch {}
    }
    const combined = texts.join("\n\n").slice(0, 10000);

    const ctx = {
      name: "Onyx & Iron Construction",
      website: "https://www.onyx-iron.com",
      summary: combined.slice(0, 1500),
      phone: extractField(combined, /(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/),
      email: extractField(combined, /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/),
      syncedAt: new Date().toISOString(),
    };

    // Ask AI to extract structured info if AI is configured
    const cfg = getActiveConfig() || getConfig();
    if (cfg) {
      try {
        const extracted = await chatJSON(cfg,
          "Extract structured company information from this website text. Return JSON.",
          `Website text:\n${combined}\n\nExtract: { "name": "", "tagline": "", "services": "comma-separated list", "serviceArea": "", "phone": "", "email": "", "summary": "2-3 sentence description" }`
        );
        Object.assign(ctx, extracted);
      } catch {}
    }

    fs.writeFileSync(COMPANY_CTX_FILE, JSON.stringify(ctx, null, 2));
    res.json({ ok: true, ctx });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/company/context", (req, res) => {
  try {
    const ctx = JSON.parse(fs.readFileSync(COMPANY_CTX_FILE, "utf8"));
    res.json({ ctx });
  } catch {
    res.json({ ctx: null });
  }
});

// ── App Contacts (global address book) ───────────────────────────
const CONTACTS_FILE = path.join(STORE_DATA, "app-contacts.json");

function loadAppContacts() {
  try { return JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8")); } catch { return []; }
}
function saveAppContacts(contacts) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

app.get("/api/app-contacts", (req, res) => {
  let contacts = loadAppContacts();
  const { q, type, project } = req.query;
  if (q) {
    const ql = q.toLowerCase();
    contacts = contacts.filter(c =>
      [c.name, c.company, c.email, c.phone, c.title, c.address, c.notes].some(f => (f||"").toLowerCase().includes(ql))
    );
  }
  if (type) contacts = contacts.filter(c => c.type === type);
  if (project) contacts = contacts.filter(c => (c.projects||[]).includes(project));
  res.json({ contacts });
});

app.post("/api/app-contacts", (req, res) => {
  const contacts = loadAppContacts();
  const contact = {
    id: "ct_" + Date.now(),
    ...req.body,
    projects: req.body.projects || [],
    source: req.body.source || "manual",
    createdAt: new Date().toISOString(),
  };
  contacts.push(contact);
  saveAppContacts(contacts);
  res.json({ contact });
});

app.put("/api/app-contacts/:id", (req, res) => {
  const contacts = loadAppContacts();
  const idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  contacts[idx] = { ...contacts[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  saveAppContacts(contacts);
  res.json({ contact: contacts[idx] });
});

app.delete("/api/app-contacts/:id", (req, res) => {
  const contacts = loadAppContacts();
  saveAppContacts(contacts.filter(c => c.id !== req.params.id));
  res.json({ ok: true });
});

// ── CSV Import ────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line + ",") {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

const CSV_FIELD_MAP = {
  name: ["name", "full_name", "contact_name", "contact"],
  email: ["email", "email_address", "e-mail"],
  phone: ["phone", "phone_number", "mobile", "cell", "telephone"],
  company: ["company", "organization", "firm", "company_name"],
  title: ["title", "job_title", "position", "role"],
  type: ["type", "contact_type", "category"],
  address: ["address", "street_address", "location"],
  website: ["website", "url", "web"],
  notes: ["notes", "comments", "description"],
};

function mapCSVRow(row) {
  const out = {};
  for (const [field, aliases] of Object.entries(CSV_FIELD_MAP)) {
    for (const alias of aliases) {
      if (row[alias]) { out[field] = row[alias]; break; }
    }
  }
  return out;
}

app.post("/api/app-contacts/import-csv", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = req.file.buffer.toString("utf8");
    const rows = parseCSV(text);
    const existing = loadAppContacts();
    const existingEmails = new Set(existing.map(c => (c.email || "").toLowerCase()).filter(Boolean));
    const imported = [];
    const skipped = [];
    for (const row of rows) {
      const mapped = mapCSVRow(row);
      if (!mapped.name && !mapped.company) continue;
      // Deduplicate by email
      if (mapped.email && existingEmails.has(mapped.email.toLowerCase())) {
        skipped.push(mapped.email);
        continue;
      }
      const contact = {
        id: "ct_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        ...mapped,
        projects: [],
        source: "csv",
        createdAt: new Date().toISOString(),
      };
      existing.push(contact);
      imported.push(contact);
      if (mapped.email) existingEmails.add(mapped.email.toLowerCase());
    }
    saveAppContacts(existing);
    res.json({ ok: true, imported: imported.length, skipped: skipped.length, total: existing.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Extract contacts from a specific plan ─────────────────────────
app.post("/api/documents/:id/extract-contacts", async (req, res) => {
  try {
    const cfg = getActiveConfig() || getConfig();
    if (!cfg) return res.status(400).json({ error: "No AI provider configured" });
    // Find the doc and its first rendered page
    const doc = getDoc(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    // Find rendered page 1
    const rasterDir = path.join(STORE_DATA, "rasters");
    const rasterPath = path.join(rasterDir, `${req.params.id}_1.png`);
    if (!fs.existsSync(rasterPath)) return res.status(404).json({ error: "Raster not found — open the plan first" });
    const result = await extractPlanContacts(cfg, rasterPath);
    // Auto-save new contacts to the address book
    if (result.contacts.length) {
      const existing = loadAppContacts();
      const existingEmails = new Set(existing.map(c => (c.email || "").toLowerCase()).filter(Boolean));
      let added = 0;
      for (const c of result.contacts) {
        if (c.email && existingEmails.has(c.email.toLowerCase())) continue;
        existing.push({
          id: "ct_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          ...c,
          projects: req.body.projectId ? [req.body.projectId] : [],
          source: "plan:" + (doc.fileName || req.params.id),
          createdAt: new Date().toISOString(),
        });
        if (c.email) existingEmails.add(c.email.toLowerCase());
        added++;
      }
      saveAppContacts(existing);
      result.added = added;
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Self-scan (app health + AI analysis) ─────────────────────────
app.post("/api/scan", async (req, res) => {
  // Top-level guard: never let this handler crash the server process
  try {
    const issues = [];
    const info   = [];
    const ROOT   = path.dirname(fileURLToPath(import.meta.url));

    // ── 1. AI providers ─────────────────────────────────────────────────
    try {
      const integ = getIntegrations();
      const providers = integ.providers || {};
      const n = Object.keys(providers).length;
      if (n === 0) issues.push({ severity: "error", area: "AI Providers", msg: "No AI providers configured — plans cannot be processed and agent queries will fail." });
      else info.push(`${n} AI provider(s): ${Object.keys(providers).join(", ")}`);
      if (integ.activeProvider) info.push(`Active provider: ${integ.activeProvider}`);
    } catch (e) { issues.push({ severity: "error", area: "AI Providers", msg: `integrations.js threw: ${e.message}` }); }

    // ── 2. Data file integrity ───────────────────────────────────────────
    const DATA_FILES = ["db.json", "projects.json", "app-contacts.json", "integrations.json"];
    for (const f of DATA_FILES) {
      const fp = path.join(STORE_DATA, f);
      if (!fs.existsSync(fp)) {
        issues.push({ severity: "warn", area: "Data", msg: `${f} not yet created — will auto-generate on first write` });
        continue;
      }
      try { JSON.parse(fs.readFileSync(fp, "utf8")); }
      catch (e) { issues.push({ severity: "error", area: "Data", msg: `Corrupt JSON in ${f}: ${e.message}` }); }
    }

    // ── 3. Required server modules ───────────────────────────────────────
    const REQUIRED_LIBS = [
      "lib/store.js", "lib/ingest.js", "lib/llm.js", "lib/providers.js",
      "lib/vision-takeoff.js", "lib/doc-store.js", "lib/project-store.js",
      "lib/agent.js", "lib/cpm.js", "lib/db.js", "lib/integrations.js",
      "lib/website.js", "lib/agents/index.js", "lib/chatbot-tools.js",
    ];
    for (const lib of REQUIRED_LIBS) {
      if (!fs.existsSync(path.join(ROOT, lib)))
        issues.push({ severity: "error", area: "Modules", msg: `Missing required module: ${lib}` });
    }
    info.push(`${REQUIRED_LIBS.filter(l => fs.existsSync(path.join(ROOT, l))).length}/${REQUIRED_LIBS.length} server modules present`);

    // ── 4. Frontend assets ───────────────────────────────────────────────
    const FRONTEND_FILES = ["public/index.html", "public/takeoff-grid.js"];
    for (const f of FRONTEND_FILES) {
      if (!fs.existsSync(path.join(ROOT, f)))
        issues.push({ severity: "error", area: "Frontend", msg: `Missing frontend asset: ${f}` });
    }

    // ── 5. Documents & raster integrity ─────────────────────────────────
    let docs = [];
    try { docs = listDocs() || []; } catch {}
    const rasterDir = path.join(STORE_DATA, "rasters");
    let orphanedRasters = 0, missingRasters = 0;
    try {
      if (fs.existsSync(rasterDir)) {
        const rasters   = fs.readdirSync(rasterDir).filter(f => f.endsWith(".png"));
        const docIds    = new Set(docs.map(d => d.id));
        for (const r of rasters) { if (!docIds.has(r.split("_")[0])) orphanedRasters++; }
        for (const doc of docs.filter(d => d.status === "ready")) {
          if (!fs.existsSync(path.join(rasterDir, `${doc.id}_1.png`))) missingRasters++;
        }
      }
    } catch {}
    if (orphanedRasters > 0) issues.push({ severity: "warn", area: "Storage", msg: `${orphanedRasters} orphaned raster file(s) — documents deleted but PNG images remain on disk` });
    if (missingRasters > 0) issues.push({ severity: "warn", area: "Storage", msg: `${missingRasters} plan(s) marked "ready" but page-1 raster is missing — may need re-upload` });
    info.push(`${docs.length} document(s) in library`);

    // ── 6. Parsed cache (parsed/{docId}.json) ────────────────────────────
    try {
      const parsedDir = path.join(STORE_DATA, "parsed");
      if (fs.existsSync(parsedDir)) {
        const cacheFiles = fs.readdirSync(parsedDir).filter(f => f.endsWith(".json"));
        const docIds     = new Set(docs.map(d => d.id));
        const orphaned   = cacheFiles.filter(f => !docIds.has(f.replace(".json", ""))).length;
        if (orphaned > 0) issues.push({ severity: "info", area: "Cache", msg: `${orphaned} stale parsed cache file(s) — delete data/parsed/*.json for removed documents to reclaim disk` });
        info.push(`${cacheFiles.length} document intelligence cache file(s)`);
      }
    } catch {}

    // ── 7. Projects ──────────────────────────────────────────────────────
    let projects = [];
    try { const raw = JSON.parse(fs.readFileSync(path.join(STORE_DATA, "projects.json"), "utf8")); projects = Array.isArray(raw) ? raw : (raw.projects || []); } catch {}
    const noBudget   = projects.filter(p => !p.budget || p.budget === 0).length;
    const noSchedule = projects.filter(p => !p.startDate).length;
    if (noBudget   > 0) issues.push({ severity: "info", area: "Projects", msg: `${noBudget} project(s) missing budget — cost-to-complete tracking disabled` });
    if (noSchedule > 0) issues.push({ severity: "info", area: "Projects", msg: `${noSchedule} project(s) missing start date — CPM schedule cannot compute dates` });
    info.push(`${projects.length} project(s), ${projects.filter(p => p.status === "active").length} active`);

    // ── 8. Contacts ──────────────────────────────────────────────────────
    try {
      const contacts       = loadAppContacts();
      const noEmail        = contacts.filter(c => !c.email).length;
      const noPhone        = contacts.filter(c => !c.phone).length;
      const noDuplicate    = new Set(contacts.map(c => c.email?.toLowerCase()).filter(Boolean)).size;
      info.push(`${contacts.length} contact(s), ${noDuplicate} unique emails`);
      if (contacts.length > 5 && (noEmail + noPhone) > contacts.length * 0.5)
        issues.push({ severity: "info", area: "Contacts", msg: `${noEmail} missing email, ${noPhone} missing phone — incomplete contact records reduce bid & communication automation` });
    } catch {}

    // ── 9. Python stream server reachability ─────────────────────────────
    try {
      const ctrl    = new AbortController();
      const timer   = setTimeout(() => ctrl.abort(), 2000);
      const health  = await fetch("http://localhost:5050/api/health", { signal: ctrl.signal });
      clearTimeout(timer);
      if (health.ok) info.push("Python takeoff stream server (port 5050) is reachable");
      else issues.push({ severity: "warn", area: "Stream Server", msg: `Python stream server responded with HTTP ${health.status} — takeoff grid streaming may not work` });
    } catch {
      issues.push({ severity: "warn", area: "Stream Server", msg: "Python takeoff stream server (port 5050) is not reachable — run: python takeoff_api.py" });
    }

    // ── 10. Environment variables ────────────────────────────────────────
    const ENV_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"];
    const setVars  = ENV_VARS.filter(v => process.env[v]);
    if (setVars.length === 0) issues.push({ severity: "warn", area: "Environment", msg: "No AI API keys found in environment — configure them in Integrations or set env vars" });
    else info.push(`Env API keys present: ${setVars.join(", ")}`);

    // ── 11. AI synthesis ─────────────────────────────────────────────────
    let aiAnalysis = null;
    try {
      const cfg = getActiveConfig() || getConfig();
      if (cfg) {
        const { chatText } = await import("./lib/providers.js");
        const prompt = `You are an expert system auditor for Onyx Intel, a construction takeoff and project management platform used by Onyx & Iron Construction.

SCAN FINDINGS (${issues.length} total):
${issues.length ? issues.map((i, n) => `${n + 1}. [${i.severity.toUpperCase()}] ${i.area}: ${i.msg}`).join("\n") : "No issues detected."}

SYSTEM STATS:
${info.join("\n")}

Write a concise diagnostic summary (3–5 sentences max). Cover:
- The single most critical item to fix if any exist
- Whether the data pipeline (stream server + takeoff grid) is ready to use
- One concrete optimization the team should do next week

Be terse and construction-focused. No generic advice.`;
        aiAnalysis = await chatText(cfg, "You are a construction software diagnostic assistant.", [{ role: "user", content: prompt }]);
      }
    } catch {}

    res.json({ issues, info, aiAnalysis, scannedAt: new Date().toISOString() });

  } catch (fatalErr) {
    // Final safety net — return JSON even if something catastrophic happened
    res.status(500).json({
      issues: [{ severity: "error", area: "Scan Engine", msg: `Scan crashed: ${fatalErr.message}` }],
      info: [],
      aiAnalysis: null,
      scannedAt: new Date().toISOString(),
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// EXTERNAL CONNECTORS
// ══════════════════════════════════════════════════════════════════

// ── Connector CRUD ────────────────────────────────────────────────
app.get("/api/connectors", (req, res) => {
  const connectors = getConnectors();
  // Return status without exposing full secrets
  const safe = {};
  for (const [id, cfg] of Object.entries(connectors)) {
    safe[id] = { configured: true, updatedAt: cfg.updatedAt, label: cfg.label || id };
    // Expose non-secret metadata
    if (cfg.from) safe[id].from = cfg.from;
    if (cfg.webhookUrl) safe[id].webhookUrlSet = true;
    if (cfg.sandbox !== undefined) safe[id].sandbox = cfg.sandbox;
  }
  const ms = getMSTokens();
  const qb = getQBTokens();
  res.json({
    connectors: safe,
    microsoft: ms ? { connected: true, email: ms.email, name: ms.name } : { connected: false },
    quickbooks: qb ? { connected: true, realmId: qb.realmId } : { connected: false },
  });
});

app.post("/api/connectors/:id", (req, res) => {
  const { id } = req.params;
  const cfg = req.body || {};
  saveConnector(id, cfg);
  res.json({ ok: true });
});

app.delete("/api/connectors/:id", (req, res) => {
  removeConnector(req.params.id);
  res.json({ ok: true });
});

// ── Web Search ────────────────────────────────────────────────────
app.post("/api/search", async (req, res) => {
  const { query, num = 8 } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });
  const connectors = getConnectors();
  // Try Serper first, fall back to Brave
  if (connectors.serper?.apiKey) {
    try {
      const results = await searchWeb(connectors.serper.apiKey, query, num);
      return res.json(results);
    } catch (e) { console.warn("[search] Serper failed:", e.message); }
  }
  if (connectors.brave?.apiKey) {
    try {
      const results = await searchBrave(connectors.brave.apiKey, query, num);
      return res.json(results);
    } catch (e) { console.warn("[search] Brave failed:", e.message); }
  }
  res.status(400).json({ error: "No search provider configured. Add a Serper or Brave Search API key in Integrations." });
});

app.post("/api/search/test", async (req, res) => {
  const { apiKey, provider = "serper" } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });
  try {
    const results = provider === "brave"
      ? await searchBrave(apiKey, "Onyx Iron Construction DFW", 3)
      : await searchWeb(apiKey, "Onyx Iron Construction DFW Texas", 3);
    res.json({ ok: true, results: results.results?.length || 0 });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Weather ───────────────────────────────────────────────────────
app.get("/api/weather/:location", async (req, res) => {
  const connectors = getConnectors();
  if (!connectors.weather?.apiKey) return res.status(400).json({ error: "OpenWeatherMap API key not configured" });
  try {
    const data = await getWeather(connectors.weather.apiKey, decodeURIComponent(req.params.location));
    res.json(data);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/weather/test", async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });
  try {
    const data = await getWeather(apiKey, "Dallas, TX");
    res.json({ ok: true, sample: `${data.temp} ${data.description} in ${data.location}` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Slack ─────────────────────────────────────────────────────────
app.post("/api/slack/send", async (req, res) => {
  const connectors = getConnectors();
  if (!connectors.slack?.webhookUrl) return res.status(400).json({ error: "Slack webhook not configured" });
  const { message, blocks } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });
  try {
    await sendSlack(connectors.slack.webhookUrl, message, blocks);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/slack/test", async (req, res) => {
  const { webhookUrl } = req.body || {};
  if (!webhookUrl) return res.status(400).json({ error: "webhookUrl required" });
  try {
    await sendSlack(webhookUrl, "✅ Onyx Intel connected to Slack — ready to send project notifications.");
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Twilio SMS ────────────────────────────────────────────────────
app.post("/api/sms/send", async (req, res) => {
  const connectors = getConnectors();
  const twilio = connectors.twilio;
  if (!twilio?.accountSid || !twilio?.authToken || !twilio?.from) {
    return res.status(400).json({ error: "Twilio not configured" });
  }
  const { to, message } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: "to and message required" });
  try {
    const result = await sendSMS(twilio.accountSid, twilio.authToken, twilio.from, to, message);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/sms/test", async (req, res) => {
  const { accountSid, authToken, from, testTo } = req.body || {};
  if (!accountSid || !authToken || !from) return res.status(400).json({ error: "accountSid, authToken, from required" });
  try {
    const result = await sendSMS(accountSid, authToken, from, testTo || from, "Onyx Intel SMS test — connected successfully.");
    res.json({ ok: true, sid: result.sid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Zapier ────────────────────────────────────────────────────────
app.post("/api/zapier/trigger", async (req, res) => {
  const connectors = getConnectors();
  if (!connectors.zapier?.webhookUrl) return res.status(400).json({ error: "Zapier webhook not configured" });
  const { event = "onyx_event", data = {} } = req.body || {};
  try {
    await triggerZapier(connectors.zapier.webhookUrl, { event, ...data });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/zapier/test", async (req, res) => {
  const { webhookUrl } = req.body || {};
  if (!webhookUrl) return res.status(400).json({ error: "webhookUrl required" });
  try {
    await triggerZapier(webhookUrl, { event: "test", message: "Onyx Intel connected", source: "onyx-intel" });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Microsoft 365 OAuth ───────────────────────────────────────────
app.post("/api/auth/microsoft/start", (req, res) => {
  const { clientId, clientSecret, tenantId = "common" } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ error: "clientId and clientSecret required" });
  savePendingMSOAuth(clientId, clientSecret, tenantId);
  const url = getMSAuthUrl(clientId, tenantId);
  res.json({ url, redirectUri: `http://localhost:${PORT}/api/auth/microsoft/callback` });
});

app.get("/api/auth/microsoft/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px"><h2 style="color:#ef4444">Microsoft OAuth Error</h2><p>${error}</p><a href="http://localhost:${PORT}" style="color:#ceff00">← Back</a></body></html>`);
  }
  try {
    const pending = getPendingMSOAuth();
    if (!pending) throw new Error("No pending Microsoft OAuth session");
    const tokens = await exchangeMSCode(code, pending.clientId, pending.clientSecret, pending.tenantId);
    saveMSTokens({ ...tokens, tenantId: pending.tenantId });
    clearPendingMSOAuth();
    res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2 style="color:#ceff00">✓ Microsoft 365 Connected!</h2><p>${tokens.email || ""}</p><p>You can close this tab.</p><script>setTimeout(()=>window.close(),2000)</script></div></body></html>`);
  } catch (e) {
    res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px"><h2 style="color:#ef4444">Error</h2><pre>${e.message}</pre><a href="http://localhost:${PORT}" style="color:#ceff00">← Back</a></body></html>`);
  }
});

app.delete("/api/auth/microsoft", (req, res) => {
  clearMSTokens();
  res.json({ ok: true });
});

// ── Microsoft 365 Data Endpoints ──────────────────────────────────
async function getMSClient() {
  let tokens = getMSTokens();
  if (!tokens) return null;
  // Refresh if needed (expire check)
  if (tokens.expires_in && tokens.savedAt) {
    const age = (Date.now() - new Date(tokens.savedAt).getTime()) / 1000;
    if (age > tokens.expires_in - 60) {
      try {
        const refreshed = await refreshMSToken(tokens);
        tokens = { ...tokens, ...refreshed, savedAt: new Date().toISOString() };
        saveMSTokens(tokens);
      } catch (e) { console.warn("MS token refresh failed:", e.message); }
    }
  }
  return tokens;
}

app.get("/api/microsoft/files", async (req, res) => {
  const tokens = await getMSClient();
  if (!tokens) return res.status(401).json({ error: "Microsoft 365 not connected" });
  try { res.json({ files: await msListFiles(tokens) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/microsoft/emails", async (req, res) => {
  const tokens = await getMSClient();
  if (!tokens) return res.status(401).json({ error: "Microsoft 365 not connected" });
  const { q } = req.query;
  try { res.json({ emails: await msListEmails(tokens, 20, q) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/microsoft/emails/send", async (req, res) => {
  const tokens = await getMSClient();
  if (!tokens) return res.status(401).json({ error: "Microsoft 365 not connected" });
  try { await msSendEmail(tokens, req.body); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/microsoft/calendar", async (req, res) => {
  const tokens = await getMSClient();
  if (!tokens) return res.status(401).json({ error: "Microsoft 365 not connected" });
  try { res.json({ events: await msListCalendar(tokens, Number(req.query.days) || 7) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── QuickBooks OAuth ──────────────────────────────────────────────
app.post("/api/auth/quickbooks/start", (req, res) => {
  const { clientId, clientSecret, sandbox = false } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ error: "clientId and clientSecret required" });
  savePendingQBOAuth(clientId, clientSecret, sandbox);
  const url = getQBAuthUrl(clientId, sandbox);
  res.json({ url });
});

app.get("/api/auth/quickbooks/callback", async (req, res) => {
  const { code, realmId, error } = req.query;
  if (error) {
    return res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px"><h2 style="color:#ef4444">QuickBooks Error</h2><p>${error}</p><a href="http://localhost:${PORT}" style="color:#ceff00">← Back</a></body></html>`);
  }
  try {
    const pending = getPendingQBOAuth();
    if (!pending) throw new Error("No pending QuickBooks OAuth session");
    const tokens = await exchangeQBCode(code, pending.clientId, pending.clientSecret, realmId);
    saveQBTokens({ ...tokens, sandbox: pending.sandbox });
    clearPendingQBOAuth();
    res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2 style="color:#ceff00">✓ QuickBooks Connected!</h2><p>Company ID: ${realmId}</p><p>You can close this tab.</p><script>setTimeout(()=>window.close(),2000)</script></div></body></html>`);
  } catch (e) {
    res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px"><h2 style="color:#ef4444">Error</h2><pre>${e.message}</pre><a href="http://localhost:${PORT}" style="color:#ceff00">← Back</a></body></html>`);
  }
});

app.delete("/api/auth/quickbooks", (req, res) => {
  clearQBTokens();
  res.json({ ok: true });
});

app.get("/api/quickbooks/invoices", async (req, res) => {
  const tokens = getQBTokens();
  if (!tokens) return res.status(401).json({ error: "QuickBooks not connected" });
  try { res.json({ invoices: await qbGetInvoices(tokens, 20, tokens.sandbox) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/quickbooks/expenses", async (req, res) => {
  const tokens = getQBTokens();
  if (!tokens) return res.status(401).json({ error: "QuickBooks not connected" });
  try { res.json({ expenses: await qbGetExpenses(tokens, 20, tokens.sandbox) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Agent Tool Execution (connector tools called by agent) ────────
app.post("/api/agent/tools/execute", async (req, res) => {
  const { tool, args = {} } = req.body || {};
  if (!tool) return res.status(400).json({ error: "tool required" });
  const connectors = getConnectors();
  try {
    let result;
    switch (tool) {
      case "search_web":
      case "search_materials": {
        const q = tool === "search_materials" ? `${args.query} DFW Texas supplier price 2025` : args.query;
        if (connectors.serper?.apiKey) result = await searchWeb(connectors.serper.apiKey, q, args.num || 6);
        else if (connectors.brave?.apiKey) result = await searchBrave(connectors.brave.apiKey, q, args.num || 6);
        else throw new Error("No search provider configured");
        break;
      }
      case "get_weather": {
        if (!connectors.weather?.apiKey) throw new Error("Weather not configured");
        result = await getWeather(connectors.weather.apiKey, args.location || "Dallas TX");
        break;
      }
      case "send_slack": {
        if (!connectors.slack?.webhookUrl) throw new Error("Slack not configured");
        result = await sendSlack(connectors.slack.webhookUrl, args.message);
        break;
      }
      case "send_sms": {
        const t = connectors.twilio;
        if (!t?.accountSid) throw new Error("Twilio not configured");
        result = await sendSMS(t.accountSid, t.authToken, t.from, args.to, args.message);
        break;
      }
      case "trigger_zapier": {
        if (!connectors.zapier?.webhookUrl) throw new Error("Zapier not configured");
        result = await triggerZapier(connectors.zapier.webhookUrl, { event: args.event, ...args.data });
        break;
      }
      case "list_onedrive_files": {
        const msTokens = await getMSClient();
        if (!msTokens) throw new Error("Microsoft 365 not connected");
        result = await msListFiles(msTokens);
        break;
      }
      case "send_outlook_email": {
        const msTokens = await getMSClient();
        if (!msTokens) throw new Error("Microsoft 365 not connected");
        result = await msSendEmail(msTokens, args);
        break;
      }
      case "get_invoices": {
        const qbTokens = getQBTokens();
        if (!qbTokens) throw new Error("QuickBooks not connected");
        result = await qbGetInvoices(qbTokens, args.top || 10, qbTokens.sandbox);
        break;
      }
      case "get_expenses": {
        const qbTokens = getQBTokens();
        if (!qbTokens) throw new Error("QuickBooks not connected");
        result = await qbGetExpenses(qbTokens, args.top || 10, qbTokens.sandbox);
        break;
      }
      case "list_drive_files": {
        const auth = await getAuthenticatedClient();
        if (!auth) throw new Error("Google Drive not connected");
        result = await driveListFiles(auth, args.folder || null);
        break;
      }
      case "create_website_page": {
        const saved = savePage(args.name, args.html, args.meta || {});
        result = { ok: true, name: saved.name, message: `Page "${args.name}" saved` };
        break;
      }
      case "update_website_settings": {
        result = saveWebsiteSettings(args);
        break;
      }
      case "generate_llms_txt": {
        const settings = getWebsiteSettings();
        const llmsTxt = generateLlmsTxt(args.businessData ? { ...settings, ...args.businessData } : settings);
        savePage("llms-txt", llmsTxt, { title: "llms.txt", isText: true });
        result = { ok: true, content: llmsTxt };
        break;
      }
      case "generate_schema_org": {
        const settings2 = getWebsiteSettings();
        const schema = generateSchemaOrg(args.businessData ? { ...settings2, ...args.businessData } : settings2);
        result = { ok: true, schema };
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Document summary backfill ─────────────────────────────────────
// Generates document summaries for already-processed plans that don't have them yet.
// Runs at startup and can be triggered via POST /api/backfill-summaries.
async function backfillDocumentSummaries() {
  try {
    const allDocs = listDocuments().filter(d => d.status === "ready");
    const allProjects = listProjects();
    const disciplineMap = { A: "Architectural", S: "Structural", M: "Mechanical", P: "Plumbing", E: "Electrical", C: "Civil", L: "Landscape", FP: "Fire Protection", T: "Title" };
    let count = 0;
    for (const meta of allDocs) {
      const linkedProjects = allProjects.filter(p => (p.planIds || []).includes(meta.id));
      if (!linkedProjects.length) continue;
      const needsSummary = linkedProjects.some(p => !p.documentSummaries?.[meta.id]);
      if (!needsSummary) continue;
      const doc = getDocument(meta.id);
      if (!doc) continue;
      const pages = doc.pages || [];
      const sheets = [...new Set(pages.map(p => p.sheet).filter(Boolean))].sort();
      const disciplines = [...new Set(sheets.map(s => {
        const prefix = s.match(/^([A-Z]+)/)?.[1] || "";
        return disciplineMap[prefix] || null;
      }).filter(Boolean))];
      const summary = {
        docId: meta.id,
        fileName: doc.fileName || meta.id,
        pageCount: doc.pageCount || pages.length,
        processedPages: pages.length,
        visionPages: pages.filter(p => p.source === "vision").length,
        embeddedPages: pages.filter(p => p.source === "embedded").length,
        sheets,
        disciplines,
        processedAt: doc.createdAt || new Date().toISOString(),
      };
      for (const proj of linkedProjects) {
        if (!proj.documentSummaries?.[meta.id]) {
          upsertDocumentSummary(proj.id, meta.id, summary);
          count++;
        }
      }
    }
    if (count > 0) console.log(`   Backfilled document summaries for ${count} project-document link(s)`);
    return { count };
  } catch (e) {
    console.warn("backfill summaries warning:", e.message);
    return { count: 0, error: e.message };
  }
}

app.post("/api/backfill-summaries", async (req, res) => {
  const result = await backfillDocumentSummaries();
  res.json({ ok: true, ...result });
});

// Trigger intelligence extraction for all ready docs that don't have a cache yet
app.post("/api/backfill-intelligence", async (req, res) => {
  const docs = listDocuments().filter(d => d.status === "ready");
  let queued = 0;
  for (const meta of docs) {
    if (getDocParsed(meta.id)) continue; // already cached
    const doc = getDocument(meta.id);
    if (!doc) continue;
    const pages = (doc.pages || []).map(pg => ({
      page: pg.page, sheet: pg.sheet || null, text: readPageText(meta.id, pg.page),
    }));
    if (pages.length) {
      extractDocumentIntelligence(meta.id, pages).catch(e =>
        console.warn(`[cache] backfill error for ${meta.fileName}:`, e.message)
      );
      queued++;
    }
  }
  res.json({ ok: true, queued, total: docs.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const s = aiStatus();
  console.log("⚡ ONYX INTEL (personal) — Onyx & Iron Construction");
  console.log(`   Open  http://localhost:${PORT}`);
  console.log(
    `   AI:   ${s.configured ? `${s.provider} · ${s.model}` : "not set yet — add a key in Settings (in the app)"}`
  );

  // Re-queue any documents that were stuck mid-processing when the server last stopped
  const stuck = listDocuments().filter(d => d.status === "processing");
  if (stuck.length) {
    console.log(`   Re-queuing ${stuck.length} stuck document(s)...`);
    for (const doc of stuck) {
      updateDocument(doc.id, { processedPages: 0, pages: [] });
      ingestDocument(doc.id).catch(e => console.error(`Re-ingest error (${doc.fileName}):`, e));
    }
  }

  // Backfill document summaries for already-processed plans (async, non-blocking)
  backfillDocumentSummaries();
});
