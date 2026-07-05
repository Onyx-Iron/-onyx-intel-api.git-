import fs from "node:fs";
import path from "node:path";
import { filePath, RASTERS } from "./store.js";

const SCALE = Number(process.env.RENDER_SCALE || 2);

export async function renderPage(docId, pageNumber) {
  const dir = path.join(RASTERS, docId);
  const out = path.join(dir, `${pageNumber}.png`);
  if (fs.existsSync(out)) return out;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(fs.readFileSync(filePath(docId)), "application/pdf");
  try {
    const page = doc.loadPage(pageNumber - 1);
    const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(out, Buffer.from(pix.asPNG()));
    try { pix.destroy?.(); } catch {}
    try { page.destroy?.(); } catch {}
  } finally {
    try { doc.destroy?.(); } catch {}
  }
  return out;
}
