"use client";

/**
 * Client-side "Export to Google Sheets" helper.
 * Requests a Google OAuth token (spreadsheets scope) via GIS, creates a new
 * spreadsheet in the user's Drive, writes the rows, and returns the URL.
 *
 * Reuses NEXT_PUBLIC_GOOGLE_CLIENT_ID (same OAuth client as the Drive picker).
 * Requires the Google Sheets API enabled on the Cloud project.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    __gisLoaded?: boolean;
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve) => {
    if (window.__gisLoaded) return resolve();
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      window.__gisLoaded = true;
      return resolve();
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => { window.__gisLoaded = true; resolve(); };
    document.head.appendChild(s);
  });
}

function getToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error("Google authorization is not loaded."));
      return;
    }

    const tokenClient: TokenClient = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: { access_token?: string; error?: string }) => {
        if (resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp.error ?? "Authorization failed"));
      },
    });
    tokenClient.requestAccessToken();
  });
}

export interface SheetExport {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

/**
 * Creates a Google Sheet and returns its shareable URL.
 * @throws if the user denies access or the Sheets API call fails.
 */
export async function exportToGoogleSheet(data: SheetExport): Promise<string> {
  if (!CLIENT_ID) throw new Error("Google is not configured (missing client ID).");
  await loadGis();
  const token = await getToken();

  // 1. Create the spreadsheet with the header + data rows inline.
  const values = [data.headers, ...data.rows.map((r) => r.map((c) => c))];
  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: data.title },
      sheets: [{
        properties: { title: "Sheet1" },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: values.map((row) => ({
            values: row.map((cell) => ({
              userEnteredValue:
                typeof cell === "number"
                  ? { numberValue: cell }
                  : { stringValue: String(cell) },
            })),
          })),
        }],
      }],
    }),
  });

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`Sheets API ${createRes.status}: ${detail.slice(0, 300)}`);
  }

  const sheet = await createRes.json() as { spreadsheetUrl?: string; spreadsheetId?: string };
  return sheet.spreadsheetUrl
    ?? `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`;
}
