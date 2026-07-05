import { google } from "googleapis";
import { getGoogleTokens, saveGoogleTokens } from "./integrations.js";

export const REDIRECT_URI = "http://localhost:3100/api/auth/google/callback";

export const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/contacts.readonly",
];

export function createOAuth2Client(clientId, clientSecret) {
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

export function getAuthUrl(clientId, clientSecret) {
  const client = createOAuth2Client(clientId, clientSecret);
  return client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
}

export async function exchangeCode(code, clientId, clientSecret) {
  const client = createOAuth2Client(clientId, clientSecret);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  const stored = { ...tokens, clientId, clientSecret, email: profile.email, name: profile.name, picture: profile.picture };
  saveGoogleTokens(stored);
  return stored;
}

export async function getAuthenticatedClient() {
  const tokens = getGoogleTokens();
  if (!tokens) return null;
  const client = createOAuth2Client(tokens.clientId, tokens.clientSecret);
  client.setCredentials(tokens);
  client.on("tokens", (newTokens) => saveGoogleTokens({ ...tokens, ...newTokens }));
  return client;
}

// ── Google Drive ──────────────────────────────────────────────────
export async function driveListFiles(auth, folderId = null) {
  const drive = google.drive({ version: "v3", auth });
  const q = folderId ? `'${folderId}' in parents and trashed=false` : `name contains 'OnyxIntel' and trashed=false`;
  const res = await drive.files.list({ q, fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)", orderBy: "modifiedTime desc", pageSize: 100 });
  return res.data.files || [];
}

export async function driveUploadFile(auth, name, buffer, mimeType = "application/pdf", folderId = null) {
  const drive = google.drive({ version: "v3", auth });
  const { Readable } = await import("node:stream");
  const meta = { name, ...(folderId ? { parents: [folderId] } : {}) };
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  const res = await drive.files.create({ requestBody: meta, media: { mimeType, body: stream }, fields: "id,name,webViewLink" });
  return res.data;
}

export async function driveDownloadFile(auth, fileId) {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

export async function driveGetOrCreateFolder(auth, folderName) {
  const drive = google.drive({ version: "v3", auth });
  const existing = await drive.files.list({ q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: "files(id,name)" });
  if (existing.data.files?.length > 0) return existing.data.files[0].id;
  const folder = await drive.files.create({ requestBody: { name: folderName, mimeType: "application/vnd.google-apps.folder" }, fields: "id" });
  return folder.data.id;
}

export async function driveGetQuota(auth) {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.about.get({ fields: "storageQuota,user" });
  return res.data;
}

// ── Gmail ──────────────────────────────────────────────────────────
function parseHeaders(headers, ...names) {
  const result = {};
  for (const name of names) result[name.toLowerCase()] = headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  return result;
}

export async function gmailListRecent(auth, maxResults = 20, query = "") {
  const gmail = google.gmail({ version: "v1", auth });
  const listRes = await gmail.users.messages.list({ userId: "me", maxResults, q: query || undefined });
  const msgs = listRes.data.messages || [];
  if (!msgs.length) return [];
  const full = await Promise.all(
    msgs.map(m => gmail.users.messages.get({ userId: "me", id: m.id, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] }))
  );
  return full.map(m => {
    const h = parseHeaders(m.data.payload?.headers || [], "From", "To", "Subject", "Date");
    return { id: m.data.id, threadId: m.data.threadId, subject: h.subject || "(no subject)", from: h.from, to: h.to, date: h.date, snippet: m.data.snippet || "" };
  });
}

export async function gmailGetMessage(auth, messageId) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const msg = res.data;
  const h = parseHeaders(msg.payload?.headers || [], "From", "To", "Subject", "Date", "Cc");

  function extractBody(payload) {
    if (!payload) return "";
    if (payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf-8");
    if (payload.parts) {
      const textPart = payload.parts.find(p => p.mimeType === "text/plain") || payload.parts[0];
      return extractBody(textPart);
    }
    return "";
  }

  return { id: msg.id, threadId: msg.threadId, subject: h.subject, from: h.from, to: h.to, cc: h.cc, date: h.date, body: extractBody(msg.payload), snippet: msg.snippet || "" };
}

export async function gmailCreateDraft(auth, { to, subject, body, cc = "" }) {
  const gmail = google.gmail({ version: "v1", auth });
  const lines = [`To: ${to}`, cc ? `Cc: ${cc}` : null, `Subject: ${subject}`, `Content-Type: text/plain; charset=utf-8`, ``, body].filter(l => l !== null).join("\r\n");
  const encoded = Buffer.from(lines).toString("base64url");
  const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: encoded } } });
  return res.data;
}

export async function gmailSearchMessages(auth, query, maxResults = 15) {
  return gmailListRecent(auth, maxResults, query);
}

// ── Google Contacts (People API) ──────────────────────────────────
export async function contactsList(auth, pageSize = 200) {
  const people = google.people({ version: "v1", auth });
  const res = await people.people.connections.list({
    resourceName: "people/me",
    pageSize,
    personFields: "names,emailAddresses,phoneNumbers,organizations,addresses,biographies",
  });
  return (res.data.connections || []).map(p => ({
    name: p.names?.[0]?.displayName || "",
    email: p.emailAddresses?.[0]?.value || "",
    phone: p.phoneNumbers?.[0]?.value || "",
    company: p.organizations?.[0]?.name || "",
    title: p.organizations?.[0]?.title || "",
    address: p.addresses?.[0]?.formattedValue || "",
    notes: p.biographies?.[0]?.value || "",
  })).filter(c => c.name || c.email);
}

export async function contactsSearch(auth, query) {
  const all = await contactsList(auth);
  const q = query.toLowerCase();
  return all.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q) ||
    c.company.toLowerCase().includes(q)
  );
}
