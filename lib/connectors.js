/**
 * Onyx Intel — External Connector Implementations
 * Web search, weather, Microsoft 365, Slack, Twilio, Zapier, QuickBooks
 */

// ── Web Search (Serper.dev) ───────────────────────────────────────
export async function searchWeb(apiKey, query, num = 8) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) throw new Error(`Serper error ${res.status}`);
  const data = await res.json();
  const results = (data.organic || []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || "",
    date: r.date || null,
  }));
  const knowledge = data.knowledgeGraph ? {
    title: data.knowledgeGraph.title,
    description: data.knowledgeGraph.description,
    attributes: data.knowledgeGraph.attributes,
  } : null;
  const answerBox = data.answerBox?.answer || data.answerBox?.snippet || null;
  return { query, results, answerBox, knowledge, total: results.length };
}

// ── Brave Web Search ──────────────────────────────────────────────
export async function searchBrave(apiKey, query, count = 8) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey } });
  if (!res.ok) throw new Error(`Brave Search error ${res.status}`);
  const data = await res.json();
  const results = (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description || "",
    date: r.page_age || null,
  }));
  return { query, results, total: results.length };
}

// ── Weather (OpenWeatherMap) ──────────────────────────────────────
export async function getWeather(apiKey, location, units = "imperial") {
  const base = "https://api.openweathermap.org/data/2.5";
  // Support zip code or city name
  const qParam = /^\d{5}$/.test(location.trim())
    ? `zip=${location.trim()},US`
    : `q=${encodeURIComponent(location)}`;
  const [currentRes, forecastRes] = await Promise.all([
    fetch(`${base}/weather?${qParam}&units=${units}&appid=${apiKey}`),
    fetch(`${base}/forecast?${qParam}&units=${units}&cnt=16&appid=${apiKey}`),
  ]);
  if (!currentRes.ok) throw new Error(`Weather error ${currentRes.status} — check location or API key`);
  const [current, forecast] = await Promise.all([currentRes.json(), forecastRes.ok ? forecastRes.json() : { list: [] }]);
  const unit = units === "imperial" ? "°F" : "°C";
  const windUnit = units === "imperial" ? "mph" : "m/s";
  return {
    location: `${current.name}, ${current.sys?.country || ""}`.trim(),
    temp: `${Math.round(current.main?.temp)}${unit}`,
    feels_like: `${Math.round(current.main?.feels_like)}${unit}`,
    humidity: `${current.main?.humidity}%`,
    description: current.weather?.[0]?.description || "",
    wind: `${Math.round(current.wind?.speed)} ${windUnit} ${degToCompass(current.wind?.deg)}`,
    visibility: current.visibility ? `${(current.visibility / 1609.34).toFixed(1)} mi` : "N/A",
    conditions: current.weather?.[0]?.main || "",
    sunrise: new Date(current.sys?.sunrise * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    sunset: new Date(current.sys?.sunset * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    forecast: (forecast.list || []).slice(0, 8).map(f => ({
      time: new Date(f.dt * 1000).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" }),
      temp: `${Math.round(f.main?.temp)}${unit}`,
      description: f.weather?.[0]?.description || "",
      rain: f.rain?.["3h"] ? `${f.rain["3h"]}mm` : null,
    })),
    constructionRisk: assessConstructionRisk(current),
  };
}
function degToCompass(deg) {
  if (deg == null) return "";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}
function assessConstructionRisk(current) {
  const risks = [];
  const temp = current.main?.temp;
  const wind = current.wind?.speed;
  const conditions = current.weather?.[0]?.main?.toLowerCase() || "";
  if (temp != null && temp < 32) risks.push("❄ Below freezing — concrete pours at risk, frost protection required");
  if (temp != null && temp > 100) risks.push("🌡 Extreme heat — OSHA heat stress protocols, hydration breaks required");
  if (wind != null && wind > 25) risks.push("💨 High winds — crane ops, lift work, and scaffold may be restricted");
  if (wind != null && wind > 35) risks.push("🚫 Dangerous winds — suspend elevated work immediately");
  if (["thunderstorm","tornado"].some(r => conditions.includes(r))) risks.push("⛈ Severe weather — stop all outdoor work, seek shelter");
  if (conditions.includes("rain") || conditions.includes("drizzle")) risks.push("🌧 Rain — concrete/masonry delays, slip hazards on scaffold");
  if (conditions.includes("snow") || conditions.includes("blizzard")) risks.push("❄ Snow — site access, equipment ops, and outdoor work impacted");
  if (conditions.includes("fog")) risks.push("🌫 Low visibility — crane ops restricted, site lighting required");
  return risks.length ? risks : ["✓ Conditions appear suitable for outdoor construction work"];
}

// ── Slack (Incoming Webhook) ──────────────────────────────────────
export async function sendSlack(webhookUrl, text, blocks = null) {
  const body = blocks ? { text, blocks } : { text };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 200) throw new Error(`Slack error ${res.status}`);
  return { ok: true };
}

// ── Twilio SMS ────────────────────────────────────────────────────
export async function sendSMS(accountSid, authToken, from, to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
  return { sid: data.sid, status: data.status, to: data.to };
}

// ── Zapier Webhook ────────────────────────────────────────────────
export async function triggerZapier(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "onyx-intel", timestamp: new Date().toISOString(), ...payload }),
  });
  if (!res.ok) throw new Error(`Zapier webhook error ${res.status}`);
  return { ok: true, status: res.status };
}

// ── Microsoft 365 (Graph API) ─────────────────────────────────────
const MS_REDIRECT = "http://localhost:3100/api/auth/microsoft/callback";
const MS_SCOPES = "offline_access User.Read Files.ReadWrite Mail.Read Mail.Send Calendars.Read Calendars.ReadWrite";

export function getMSAuthUrl(clientId, tenantId = "common") {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: MS_REDIRECT,
    response_mode: "query",
    scope: MS_SCOPES,
    prompt: "consent",
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeMSCode(code, clientId, clientSecret, tenantId = "common") {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: "authorization_code", code,
      redirect_uri: MS_REDIRECT, scope: MS_SCOPES,
    }).toString(),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error_description || `MS token error ${res.status}`); }
  const tokens = await res.json();
  // Fetch user profile
  const profile = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then(r => r.json()).catch(() => ({}));
  return { ...tokens, email: profile.mail || profile.userPrincipalName, name: profile.displayName, tenantId, clientId, clientSecret };
}

export async function refreshMSToken(tokens) {
  const res = await fetch(`https://login.microsoftonline.com/${tokens.tenantId || "common"}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: tokens.clientId, client_secret: tokens.clientSecret,
      grant_type: "refresh_token", refresh_token: tokens.refresh_token,
      scope: MS_SCOPES,
    }).toString(),
  });
  if (!res.ok) throw new Error("MS token refresh failed");
  return await res.json();
}

async function graphRequest(tokens, path, method = "GET", body = null) {
  const headers = { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" };
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method, headers, body: body ? JSON.stringify(body) : null,
  });
  if (res.status === 401) throw new Error("MS_REFRESH_NEEDED");
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Graph error ${res.status}`); }
  return res.status === 204 ? null : res.json();
}

export async function msListFiles(tokens, path = "/me/drive/root/children") {
  const data = await graphRequest(tokens, `/me/drive/root/children?$select=id,name,size,lastModifiedDateTime,webUrl,file,folder&$orderby=lastModifiedDateTime desc&$top=50`);
  return (data?.value || []).map(f => ({
    id: f.id, name: f.name, size: f.size, modified: f.lastModifiedDateTime,
    url: f.webUrl, isFolder: !!f.folder, mimeType: f.file?.mimeType,
  }));
}

export async function msListEmails(tokens, top = 20, query = "") {
  const filter = query ? `&$search="${query}"` : "";
  const data = await graphRequest(tokens, `/me/messages?$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview,isRead${filter}&$orderby=receivedDateTime desc`);
  return (data?.value || []).map(m => ({
    id: m.id, subject: m.subject, from: m.from?.emailAddress,
    date: m.receivedDateTime, preview: m.bodyPreview, isRead: m.isRead,
  }));
}

export async function msSendEmail(tokens, { to, subject, body, cc = [] }) {
  await graphRequest(tokens, "/me/sendMail", "POST", {
    message: {
      subject,
      body: { contentType: "Text", content: body },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(cc.length ? { ccRecipients: cc.map(a => ({ emailAddress: { address: a } })) } : {}),
    },
    saveToSentItems: true,
  });
  return { ok: true };
}

export async function msListCalendar(tokens, days = 7) {
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();
  const data = await graphRequest(tokens, `/me/calendar/calendarView?startDateTime=${start}&endDateTime=${end}&$top=25&$select=id,subject,start,end,location,organizer`);
  return (data?.value || []).map(e => ({
    id: e.id, subject: e.subject, start: e.start?.dateTime, end: e.end?.dateTime,
    location: e.location?.displayName, organizer: e.organizer?.emailAddress,
  }));
}

// ── QuickBooks Online OAuth ───────────────────────────────────────
const QB_REDIRECT = "http://localhost:3100/api/auth/quickbooks/callback";
const QB_SCOPES = "com.intuit.quickbooks.accounting openid profile email";
const QB_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const QB_PROD_BASE = "https://quickbooks.api.intuit.com";

export function getQBAuthUrl(clientId, sandbox = false) {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: QB_SCOPES,
    redirect_uri: QB_REDIRECT,
    response_type: "code",
    state: "onyx_qb_" + Date.now(),
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params}`;
}

export async function exchangeQBCode(code, clientId, clientSecret, realmId) {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: QB_REDIRECT }).toString(),
  });
  if (!res.ok) throw new Error(`QuickBooks token error ${res.status}`);
  const tokens = await res.json();
  return { ...tokens, clientId, clientSecret, realmId };
}

async function qbRequest(tokens, endpoint, sandbox = false) {
  const base = sandbox ? QB_SANDBOX_BASE : QB_PROD_BASE;
  const res = await fetch(`${base}/v3/company/${tokens.realmId}${endpoint}&minorversion=65`, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QuickBooks API error ${res.status}`);
  return res.json();
}

export async function qbGetInvoices(tokens, top = 20, sandbox = false) {
  const data = await qbRequest(tokens, `/query?query=SELECT * FROM Invoice ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS ${top}`, sandbox);
  return (data?.QueryResponse?.Invoice || []).map(inv => ({
    id: inv.Id, docNumber: inv.DocNumber, customer: inv.CustomerRef?.name,
    total: inv.TotalAmt, balance: inv.Balance, status: inv.EmailStatus,
    dueDate: inv.DueDate, createdAt: inv.MetaData?.CreateTime,
  }));
}

export async function qbGetExpenses(tokens, top = 20, sandbox = false) {
  const data = await qbRequest(tokens, `/query?query=SELECT * FROM Purchase ORDER BY MetaData.LastUpdatedTime DESC MAXRESULTS ${top}`, sandbox);
  return (data?.QueryResponse?.Purchase || []).map(p => ({
    id: p.Id, vendor: p.EntityRef?.name, total: p.TotalAmt,
    paymentType: p.PaymentType, txnDate: p.TxnDate,
    memo: p.PrivateNote,
  }));
}

export async function qbGetPL(tokens, startDate, endDate, sandbox = false) {
  const data = await qbRequest(tokens, `/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}`, sandbox);
  return data?.Rows?.Row || [];
}
