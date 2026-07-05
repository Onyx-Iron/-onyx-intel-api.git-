"use client";

/**
 * Opens a clean, print-ready window for a document and triggers the browser's
 * print dialog (where the user can "Save as PDF"). Used for AI-generated docs,
 * status reports, RFIs, etc. No server-side PDF dependency.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printDocument(title: string, body: string, subtitle?: string): void {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) {
    alert("Please allow pop-ups for this site to print / save as PDF.");
    return;
  }
  const stamp = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; max-width: 7.5in; margin: 0.6in auto; line-height: 1.55; padding: 0 0.4in; }
  header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: baseline; }
  .brand { font-weight: 900; letter-spacing: -0.02em; font-family: system-ui, sans-serif; }
  .brand span { color: #6b8e00; }
  h1 { font-size: 19px; margin: 18px 0 2px; }
  .sub { color: #555; font-size: 12px; }
  .meta { color: #777; font-size: 10.5px; margin-bottom: 22px; font-family: system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 12.5px; margin: 0; }
  footer { margin-top: 36px; border-top: 1px solid #ccc; padding-top: 8px; color: #999; font-size: 10px; font-family: system-ui, sans-serif; }
  @media print { body { margin: 0.5in; } @page { margin: 0.5in; } }
</style></head>
<body>
  <header><span class="brand">ONYX<span>INTEL</span></span><span class="sub">onyx-iron.com</span></header>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ""}
  <div class="meta">Generated ${escapeHtml(stamp)}</div>
  <pre>${escapeHtml(body)}</pre>
  <footer>Onyx Intel — Construction AI Platform</footer>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 350);
}
