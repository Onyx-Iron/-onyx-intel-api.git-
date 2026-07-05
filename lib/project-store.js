import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.js";

const FILE = path.join(DATA, "projects.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { projects: [] }; }
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }

// Ensure every project has all required fields (migrate on read)
function hydrate(proj) {
  return {
    takeoffReports: [],
    tasks: [],
    qnaHistory: [],
    knowledgeBase: [],
    documentSummaries: {},
    contacts: [],
    planIds: [],
    notes: "",
    ...proj,
  };
}

export function listProjects() {
  return load().projects.map(hydrate);
}

export function getProject(id) {
  const p = load().projects.find(p => p.id === id);
  return p ? hydrate(p) : null;
}

export function createProject(fields) {
  const data = load();
  const proj = {
    id: `proj_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
    name: fields.name || "Untitled Project",
    address: fields.address || "",
    client: fields.client || "",
    projectType: fields.projectType || "commercial",
    status: fields.status || "active",
    budget: Number(fields.budget) || 0,
    startDate: fields.startDate || "",
    endDate: fields.endDate || "",
    description: fields.description || "",
    contacts: [],
    planIds: [],
    notes: "",
    tasks: [],
    takeoffReports: [],
    qnaHistory: [],      // saved Q&A pairs for this project
    knowledgeBase: [],   // accumulated facts extracted from answers
    documentSummaries: {}, // {docId: {fileName, pageCount, sheets, disciplines, summary}}
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.projects.unshift(proj);
  save(data);
  return proj;
}

export function updateProject(id, patch) {
  const data = load();
  const i = data.projects.findIndex(p => p.id === id);
  if (i < 0) return null;
  data.projects[i] = { ...hydrate(data.projects[i]), ...patch, updatedAt: new Date().toISOString() };
  save(data);
  return data.projects[i];
}

export function deleteProject(id) {
  const data = load();
  data.projects = data.projects.filter(p => p.id !== id);
  save(data);
}

export function addPlanToProject(projectId, planId) {
  const data = load();
  const i = data.projects.findIndex(p => p.id === projectId);
  if (i < 0) return;
  const proj = hydrate(data.projects[i]);
  if (!proj.planIds.includes(planId)) {
    proj.planIds.push(planId);
    proj.updatedAt = new Date().toISOString();
  }
  data.projects[i] = proj;
  save(data);
}

export function removePlanFromProject(projectId, planId) {
  const data = load();
  const i = data.projects.findIndex(p => p.id === projectId);
  if (i < 0) return;
  const proj = hydrate(data.projects[i]);
  proj.planIds = proj.planIds.filter(x => x !== planId);
  proj.updatedAt = new Date().toISOString();
  data.projects[i] = proj;
  save(data);
}

// ── Q&A History ───────────────────────────────────────────────────────────────
export function addQnaEntry(projectId, entry) {
  const data = load();
  const i = data.projects.findIndex(p => p.id === projectId);
  if (i < 0) return;
  const proj = hydrate(data.projects[i]);
  proj.qnaHistory = proj.qnaHistory || [];
  proj.qnaHistory.unshift({
    id: entry.id || `qna_${Date.now()}`,
    question: entry.question || "",
    answer: (entry.answer || "").slice(0, 3000), // cap stored text
    citations: entry.citations || [],
    type: entry.type || "question",  // "question" | "takeoff"
    pageCount: entry.pageCount || 0,
    ts: entry.ts || new Date().toISOString(),
  });
  // Keep last 100 entries
  if (proj.qnaHistory.length > 100) proj.qnaHistory = proj.qnaHistory.slice(0, 100);
  proj.updatedAt = new Date().toISOString();
  data.projects[i] = proj;
  save(data);
}

export function getQnaHistory(projectId, limit = 20) {
  const proj = getProject(projectId);
  if (!proj) return [];
  return (proj.qnaHistory || []).slice(0, limit);
}

// ── Knowledge Base ────────────────────────────────────────────────────────────
// Facts are short extracted statements: dimensions, specs, contacts, decisions.
export function addKnowledgeFacts(projectId, facts) {
  if (!facts || !facts.length) return;
  const data = load();
  const i = data.projects.findIndex(p => p.id === projectId);
  if (i < 0) return;
  const proj = hydrate(data.projects[i]);
  proj.knowledgeBase = proj.knowledgeBase || [];
  for (const f of facts) {
    proj.knowledgeBase.unshift({
      ...f,
      id: `fact_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
      ts: new Date().toISOString(),
    });
  }
  // Keep last 200 facts
  if (proj.knowledgeBase.length > 200) proj.knowledgeBase = proj.knowledgeBase.slice(0, 200);
  proj.updatedAt = new Date().toISOString();
  data.projects[i] = proj;
  save(data);
}

// ── Document Summaries ────────────────────────────────────────────────────────
export function upsertDocumentSummary(projectId, docId, summary) {
  const data = load();
  const i = data.projects.findIndex(p => p.id === projectId);
  if (i < 0) return;
  const proj = hydrate(data.projects[i]);
  proj.documentSummaries = proj.documentSummaries || {};
  proj.documentSummaries[docId] = { ...summary, updatedAt: new Date().toISOString() };
  proj.updatedAt = new Date().toISOString();
  data.projects[i] = proj;
  save(data);
}

// ── Full project context for agent injection ──────────────────────────────────
export function getProjectContext(projectId) {
  const proj = getProject(projectId);
  if (!proj) return null;
  return {
    id: proj.id,
    name: proj.name,
    address: proj.address,
    client: proj.client,
    projectType: proj.projectType,
    status: proj.status,
    budget: proj.budget,
    startDate: proj.startDate,
    endDate: proj.endDate,
    description: proj.description,
    notes: proj.notes,
    contacts: proj.contacts || [],
    planIds: proj.planIds || [],
    tasks: (proj.tasks || []).filter(t => !t.done).slice(0, 10),
    recentQna: (proj.qnaHistory || []).slice(0, 8),
    knowledgeBase: (proj.knowledgeBase || []).slice(0, 30),
    documentSummaries: proj.documentSummaries || {},
    takeoffReports: (proj.takeoffReports || []).slice(0, 5),
  };
}
