import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.js";

const FILE = path.join(DATA, "construction-docs.json");

const PREFIXES = {
  rfi: "RFI", po: "PO", wo: "WO", co: "CO",
  submittal: "SUB", estimate: "EST", daily: "DLY",
  meeting: "MTG", schedule: "SCH", bid: "BID",
};

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { docs: [], counters: {} }; }
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }

export function listDocs(type) {
  const { docs } = load();
  return type ? docs.filter(d => d.type === type) : docs;
}

export function getDoc(id) {
  return load().docs.find(d => d.id === id) || null;
}

export function createDoc({ type, fields = {}, status = "draft" }) {
  const data = load();
  if (!data.counters) data.counters = {};
  data.counters[type] = (data.counters[type] || 0) + 1;
  const num = String(data.counters[type]).padStart(3, "0");
  const prefix = PREFIXES[type] || "DOC";
  const doc = {
    id: `cdoc_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
    type,
    number: `${prefix}-${num}`,
    status,
    fields,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.docs.unshift(doc);
  save(data);
  return doc;
}

export function updateDoc(id, patch) {
  const data = load();
  const i = data.docs.findIndex(d => d.id === id);
  if (i < 0) return null;
  data.docs[i] = { ...data.docs[i], ...patch, updatedAt: new Date().toISOString() };
  save(data);
  return data.docs[i];
}

export function deleteDoc(id) {
  const data = load();
  data.docs = data.docs.filter(d => d.id !== id);
  save(data);
}
