/**
 * Integrations store — persists all provider configs, Google tokens,
 * and storage preferences to data/integrations.json
 */
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.js";

const FILE = path.join(DATA, "integrations.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { providers: {}, google: null, storage: { type: "local", driveSync: false }, activeProvider: null }; }
}
function save(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }

// ── Provider configs (apiKey, model per provider) ────────────────
export function getIntegrations() { return load(); }

export function saveProviderConfig(providerId, config) {
  const data = load();
  if (!data.providers) data.providers = {};
  data.providers[providerId] = { ...config, updatedAt: new Date().toISOString() };
  // Auto-set as active if none set yet
  if (!data.activeProvider) data.activeProvider = providerId;
  save(data);
  return data;
}

export function patchProviderConfig(providerId, patch) {
  const data = load();
  if (!data.providers?.[providerId]) return data;
  data.providers[providerId] = { ...data.providers[providerId], ...patch, updatedAt: new Date().toISOString() };
  save(data);
  return data;
}

export function removeProviderConfig(providerId) {
  const data = load();
  delete data.providers[providerId];
  if (data.activeProvider === providerId) {
    data.activeProvider = Object.keys(data.providers)[0] || null;
  }
  save(data);
  return data;
}

export function setActiveProvider(providerId) {
  const data = load();
  data.activeProvider = providerId;
  save(data);
  return data;
}

export function getActiveConfig() {
  const data = load();
  const id = data.activeProvider;
  if (!id || !data.providers[id]) return null;
  return { provider: id, ...data.providers[id] };
}

// ── Google OAuth tokens ───────────────────────────────────────────
export function getGoogleTokens() {
  return load().google || null;
}

export function saveGoogleTokens(tokens) {
  const data = load();
  data.google = { ...tokens, savedAt: new Date().toISOString() };
  save(data);
}

export function clearGoogleTokens() {
  const data = load();
  data.google = null;
  save(data);
}

// ── OAuth pending state (client credentials during flow) ─────────
export function savePendingOAuth(clientId, clientSecret) {
  const data = load();
  data._pendingOAuth = { clientId, clientSecret };
  save(data);
}

export function getPendingOAuth() {
  return load()._pendingOAuth || null;
}

export function clearPendingOAuth() {
  const data = load();
  delete data._pendingOAuth;
  save(data);
}

// ── Storage preferences ───────────────────────────────────────────
export function getStorage() {
  return load().storage || { type: "local", driveSync: false };
}

export function saveStorage(prefs) {
  const data = load();
  data.storage = { ...(data.storage || {}), ...prefs };
  save(data);
  return data.storage;
}

// ── External Connectors (search, weather, Slack, Twilio, Zapier, QB, M365) ──
export function getConnectors() {
  return load().connectors || {};
}

export function saveConnector(id, config) {
  const data = load();
  if (!data.connectors) data.connectors = {};
  data.connectors[id] = { ...config, updatedAt: new Date().toISOString() };
  save(data);
  return data.connectors[id];
}

export function removeConnector(id) {
  const data = load();
  if (data.connectors) delete data.connectors[id];
  save(data);
}

export function getConnector(id) {
  return load().connectors?.[id] || null;
}

// ── Microsoft 365 OAuth tokens ────────────────────────────────────
export function getMSTokens() {
  return load().microsoft || null;
}

export function saveMSTokens(tokens) {
  const data = load();
  data.microsoft = { ...tokens, savedAt: new Date().toISOString() };
  save(data);
}

export function clearMSTokens() {
  const data = load();
  data.microsoft = null;
  save(data);
}

export function savePendingMSOAuth(clientId, clientSecret, tenantId) {
  const data = load();
  data._pendingMSOAuth = { clientId, clientSecret, tenantId };
  save(data);
}

export function getPendingMSOAuth() {
  return load()._pendingMSOAuth || null;
}

export function clearPendingMSOAuth() {
  const data = load();
  delete data._pendingMSOAuth;
  save(data);
}

// ── QuickBooks OAuth tokens ───────────────────────────────────────
export function getQBTokens() {
  return load().quickbooks || null;
}

export function saveQBTokens(tokens) {
  const data = load();
  data.quickbooks = { ...tokens, savedAt: new Date().toISOString() };
  save(data);
}

export function clearQBTokens() {
  const data = load();
  data.quickbooks = null;
  save(data);
}

export function savePendingQBOAuth(clientId, clientSecret, sandbox) {
  const data = load();
  data._pendingQBOAuth = { clientId, clientSecret, sandbox };
  save(data);
}

export function getPendingQBOAuth() {
  return load()._pendingQBOAuth || null;
}

export function clearPendingQBOAuth() {
  const data = load();
  delete data._pendingQBOAuth;
  save(data);
}
