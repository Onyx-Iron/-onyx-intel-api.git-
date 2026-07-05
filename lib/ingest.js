import fs from "node:fs";
import { filePath, savePageText, readPageText, updateDocument, pushDocumentPage, RASTERS, getDocument, listDocuments } from "./store.js";
import { readSheetImage, hasKey, extractDocumentIntelligence } from "./llm.js";
import { listProjects, upsertDocumentSummary } from "./project-store.js";

const VISION_MIN_CHARS = Number(process.env.VISION_MIN_CHARS || 180);
const RENDER_SCALE    = Number(process.env.RENDER_SCALE    || 1.5);  // 1.5x = good quality, 44% smaller than 2x
const VISION_CONCURRENCY = Number(process.env.VISION_CONCURRENCY || 5); // parallel vision calls

function detectSheet(text) {
  const m = text.slice(0, 400).match(/\b([A-Z]-?\d{3}|[A-Z]\d+\.\d+|[A-Z]{1,2}-\d+)\b/);
  return m ? m[1] : null;
}

export async function ingestDocument(docId) {
  updateDocument(docId, { status: "processing" });
  try {
    const pdfBuffer = fs.readFileSync(filePath(docId));
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
    const pageCount = doc.countPages();
    updateDocument(docId, { pageCount, processedPages: 0, pages: [] });

    const visionQueue = []; // pages that need vision AI (collected in Phase 1)
    let visionCount = 0;

    // ── Phase 1: Fast pass — text extraction + rasterization (sequential; mupdf isn't concurrency-safe) ──
    const rasterDir = `${RASTERS}/${docId}`;

    for (let i = 0; i < pageCount; i++) {
      const pageNum = i + 1;

      // Resume: if cached text exists, check if it still needs vision
      const cached = readPageText(docId, pageNum);
      if (cached) {
        const chars = cached.trim().length;
        const sheet = detectSheet(cached);
        const rasterPath = `${rasterDir}/${pageNum}.png`;
        // Sparse text + raster on disk + have API key → Phase 2 didn't finish; re-queue
        if (chars < VISION_MIN_CHARS && fs.existsSync(rasterPath) && hasKey()) {
          visionQueue.push({ pageNum, sheet });
        } else {
          pushDocumentPage(docId, { page: pageNum, source: "cached", chars, sheet });
        }
        continue;
      }

      const page = doc.loadPage(i);
      let text = "";
      try { text = page.toStructuredText("preserve-whitespace").asText(); } catch {}
      const chars = text.trim().length;
      const sheet = detectSheet(text);

      if (chars < VISION_MIN_CHARS) {
        // Render raster and save to disk (needed for viewer and vision)
        const pix = page.toPixmap(mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE), mupdf.ColorSpace.DeviceRGB, false);
        const pngBuf = Buffer.from(pix.asPNG());
        try { pix.destroy?.(); } catch {}

        if (!fs.existsSync(rasterDir)) fs.mkdirSync(rasterDir, { recursive: true });
        fs.writeFileSync(`${rasterDir}/${pageNum}.png`, pngBuf);

        if (hasKey()) {
          // Save sparse placeholder so resume knows text was started
          savePageText(docId, pageNum, text);
          visionQueue.push({ pageNum, sheet });
          // Do NOT push to DB yet — Phase 2 will do it after vision
        } else {
          const source = chars < 10 ? "image-no-key" : "embedded-sparse";
          savePageText(docId, pageNum, text);
          pushDocumentPage(docId, { page: pageNum, source, chars, sheet });
        }
      } else {
        savePageText(docId, pageNum, text);
        pushDocumentPage(docId, { page: pageNum, source: "embedded", chars, sheet });
      }

      try { page.destroy?.(); } catch {}
    }

    try { doc.destroy?.(); } catch {}

    // ── Phase 2: Parallel vision pass — VISION_CONCURRENCY calls at a time ──
    for (let i = 0; i < visionQueue.length; i += VISION_CONCURRENCY) {
      const batch = visionQueue.slice(i, i + VISION_CONCURRENCY);
      await Promise.all(batch.map(async ({ pageNum, sheet: origSheet }) => {
        const rasterPath = `${rasterDir}/${pageNum}.png`;
        try {
          const pngBase64 = fs.readFileSync(rasterPath).toString("base64");
          const vText = await readSheetImage(pngBase64);
          if (vText && vText.trim().length > 0) {
            const sheet = detectSheet(vText) || origSheet;
            savePageText(docId, pageNum, vText);
            pushDocumentPage(docId, { page: pageNum, source: "vision", chars: vText.trim().length, sheet });
            visionCount++;
          } else {
            pushDocumentPage(docId, { page: pageNum, source: "image-unread", chars: 0, sheet: origSheet });
          }
        } catch {
          pushDocumentPage(docId, { page: pageNum, source: "image-error", chars: 0, sheet: origSheet });
        }
      }));
    }

    updateDocument(docId, { status: "ready", visionPages: visionCount, processedPages: pageCount });

    // Generate and persist a document summary to every project that contains this doc
    try {
      const doc = getDocument(docId);
      const pages = doc?.pages || [];
      const sheets = [...new Set(pages.map(p => p.sheet).filter(Boolean))].sort();
      // Infer disciplines from sheet prefixes
      const disciplineMap = { A: "Architectural", S: "Structural", M: "Mechanical", P: "Plumbing", E: "Electrical", C: "Civil", L: "Landscape", FP: "Fire Protection", T: "Title" };
      const disciplines = [...new Set(sheets.map(s => {
        const prefix = s.match(/^([A-Z]+)/)?.[1] || "";
        return disciplineMap[prefix] || null;
      }).filter(Boolean))];
      const visionCount2 = pages.filter(p => p.source === "vision").length;
      const embeddedCount = pages.filter(p => p.source === "embedded").length;
      const summary = {
        docId,
        fileName: doc?.fileName || docId,
        pageCount,
        processedPages: pages.length,
        visionPages: visionCount2,
        embeddedPages: embeddedCount,
        sheets,
        disciplines,
        processedAt: new Date().toISOString(),
      };
      // Link summary to any project containing this doc
      const projects = listProjects();
      for (const proj of projects) {
        if ((proj.planIds || []).includes(docId)) {
          upsertDocumentSummary(proj.id, docId, summary);
        }
      }
    } catch (sumErr) {
      console.warn("doc summary warn:", sumErr.message);
    }

    // Async intelligence extraction — builds cached parse for Q&A and takeoff reuse.
    // Runs after summary generation; non-blocking so it doesn't delay the status update.
    if (hasKey()) {
      const docSnap = getDocument(docId);
      const pagesForIntel = (docSnap?.pages || []).map(pg => ({
        page: pg.page,
        sheet: pg.sheet || null,
        text: readPageText(docId, pg.page),
      }));
      if (pagesForIntel.length > 0) {
        extractDocumentIntelligence(docId, pagesForIntel).catch(e =>
          console.warn("[cache] Post-ingest extraction error:", e.message)
        );
      }
    }
  } catch (e) {
    console.error("ingest error:", e);
    updateDocument(docId, { status: "error", error: String(e.message) });
  }
}

export function retrievePages(docs, question, k = 8) {
  const stopWords = new Set(["the","a","an","is","are","was","were","what","where","which","who","how","when","on","in","at","to","of","for","and","or","with","from"]);
  const words = question.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
  const scored = [];
  for (const doc of docs) {
    for (const pg of doc.pages || []) {
      const text = doc.readText(pg.page).toLowerCase();
      if (!text) continue;
      let score = 0;
      for (const w of words) { let idx = 0; while ((idx = text.indexOf(w, idx)) !== -1) { score++; idx++; } }
      if (pg.sheet) {
        const sheetLower = pg.sheet.toLowerCase();
        if (words.some(w => sheetLower.includes(w))) score += 5;
      }
      scored.push({ documentName: doc.fileName, documentId: doc.id, page: pg.page, sheet: pg.sheet, score, text: doc.readText(pg.page) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  if (!top.length || top[0].score === 0) {
    const fallback = [];
    for (const doc of docs) {
      for (const pg of (doc.pages || []).slice(0, 4)) {
        fallback.push({ documentName: doc.fileName, documentId: doc.id, page: pg.page, sheet: pg.sheet, score: 0, text: doc.readText(pg.page) });
        if (fallback.length >= k) break;
      }
      if (fallback.length >= k) break;
    }
    return fallback;
  }
  return top;
}
