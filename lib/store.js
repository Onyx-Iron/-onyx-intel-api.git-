import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA = path.join(ROOT, "data");
export const FILES = path.join(DATA, "files");
export const PAGES = path.join(DATA, "pages");
export const RASTERS = path.join(DATA, "rasters");
export const PARSED = path.join(DATA, "parsed"); // cached AI intelligence per document

const DB = path.join(DATA, "db.json");
const CONFIG = path.join(DATA, "config.json");

for (const d of [DATA, FILES, PAGES, RASTERS, PARSED]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Per-document intelligence cache (data/parsed/{docId}.json) ────
// Stores AI-extracted schedules, dimensions, materials, specs so
// future Q&A calls read the cache instead of re-processing all pages.
export function saveDocParsed(docId, data) {
  try { fs.writeFileSync(path.join(PARSED, `${docId}.json`), JSON.stringify(data, null, 2)); } catch {}
}
export function getDocParsed(docId) {
  try { return JSON.parse(fs.readFileSync(path.join(PARSED, `${docId}.json`), "utf8")); } catch { return null; }
}
export function clearDocParsed(docId) {
  try { fs.unlinkSync(path.join(PARSED, `${docId}.json`)); } catch {}
}

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return { documents: [] }; }
}
function writeDb(db) { fs.writeFileSync(DB, JSON.stringify(db, null, 2)); }

export function listDocuments() { return readDb().documents; }
export function getDocument(id) { return readDb().documents.find(d => d.id === id) || null; }
export function createDocument(doc) {
  const db = readDb(); db.documents.unshift(doc); writeDb(db);
}
export function updateDocument(id, patch) {
  const db = readDb();
  const i = db.documents.findIndex(d => d.id === id);
  if (i >= 0) { db.documents[i] = { ...db.documents[i], ...patch }; writeDb(db); }
}
export function filePath(id) { return path.join(FILES, `${id}.pdf`); }

export function savePageText(docId, pageNumber, text) {
  const dir = path.join(PAGES, docId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${pageNumber}.txt`), text);
}
export function readPageText(docId, pageNumber) {
  try { return fs.readFileSync(path.join(PAGES, docId, `${pageNumber}.txt`), "utf8"); } catch { return ""; }
}
export function saveRaster(docId, pageNumber, pngBuffer) {
  const dir = path.join(RASTERS, docId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${pageNumber}.png`), pngBuffer);
}

export function deleteDocument(id) {
  const db = readDb();
  db.documents = db.documents.filter(d => d.id !== id);
  writeDb(db);
}

export function pushDocumentPage(id, pageData) {
  const db = readDb();
  const i = db.documents.findIndex(d => d.id === id);
  if (i >= 0) {
    if (!Array.isArray(db.documents[i].pages)) db.documents[i].pages = [];
    db.documents[i].pages.push(pageData);
    db.documents[i].processedPages = pageData.page;
    writeDb(db);
  }
}

export function getTakeoff(id) {
  const doc = getDocument(id);
  return doc ? (doc.takeoff || { calibrations: {}, items: [] }) : { calibrations: {}, items: [] };
}
export function saveTakeoff(id, takeoff) { updateDocument(id, { takeoff }); }

export function getConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return null; }
}
export function saveConfig(cfg) { fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2)); }
export function clearConfig() { try { fs.unlinkSync(CONFIG); } catch {} }
