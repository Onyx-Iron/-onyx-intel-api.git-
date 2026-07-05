import fs from "node:fs";
import { visionRead, chatText, repairJSON } from "./providers.js";

// ─── Pass definitions ─────────────────────────────────────────────
const PASSES = [
  {
    type: "area",
    label: "Slabs & Areas",
    prompt: `You are a construction quantity surveyor analyzing a plan drawing.
Return ONLY raw JSON starting with { — no prose, no markdown, no code fences.
Coordinates: x,y as PERCENTAGE of image (0=left/top, 100=right/bottom).

TASK: Identify every AREA on this drawing.
Include: concrete slabs, floors, roof areas, parking lots, landscaping zones, rooms, structural bays, pads, plazas, patios, driveways, courtyards.
Exclude: title blocks, north arrows, scale bars, drawing borders.

Return:
{
  "sheet": "sheet number if visible",
  "scale": "scale noted on drawing if visible",
  "items": [
    {
      "type": "area",
      "label": "Concrete Slab on Grade",
      "unit": "SF",
      "points": [[x,y],[x,y],[x,y],[x,y]],
      "notes": "any printed dimensions or qty"
    }
  ]
}

Rules:
- Each area must have 3+ boundary points tracing the perimeter polygon
- Be thorough — capture every distinct area zone
- If a dimension is printed (e.g. "120x80"), put it in notes`,
  },
  {
    type: "length",
    label: "Walls & Lines",
    prompt: `You are a construction quantity surveyor analyzing a plan drawing.
Return ONLY raw JSON starting with { — no prose, no markdown, no code fences.
Coordinates: x,y as PERCENTAGE of image (0=left/top, 100=right/bottom).

TASK: Identify every LINEAR item on this drawing.
Include: exterior walls, interior walls/partitions, beams, pipes/conduit runs, trenches, curbs, gutters, fences, retaining walls, grade breaks, footings (linear), edges of paving.
Exclude: title blocks, borders, scale bars, dimension lines, annotation leaders.

Return:
{
  "items": [
    {
      "type": "length",
      "label": "Exterior CMU Wall",
      "unit": "LF",
      "points": [[x1,y1],[x2,y2]],
      "notes": "any printed dimension"
    }
  ]
}

Rules:
- Each item gets exactly 2 points: start and end of the run
- Trace each wall segment separately (don't combine different walls into one)
- If a length dimension is printed, put it in notes`,
  },
  {
    type: "count",
    label: "Equipment & Counts",
    prompt: `You are a construction quantity surveyor analyzing a plan drawing.
Return ONLY raw JSON starting with { — no prose, no markdown, no code fences.
Coordinates: x,y as PERCENTAGE of image (0=left/top, 100=right/bottom).

TASK: Identify and count every discrete ITEM or UNIT on this drawing.
Include: doors, windows, columns, point footings, fixtures, floor drains, roof drains, manholes, cleanouts, valves, fire hydrants, light poles, trees, parking stalls, structural connections, equipment pads (if named individually).
Exclude: legend/key symbols, north arrow, title block elements.

Return:
{
  "items": [
    {
      "type": "count",
      "label": "36\" Hollow Metal Door",
      "unit": "EA",
      "points": [[x1,y1],[x2,y2]],
      "notes": "size or spec if visible"
    }
  ]
}

Rules:
- Group all instances of the SAME item type into ONE entry with multiple points
- Each point [x,y] is the location of ONE instance
- Include exact label/size in the label field (e.g. "3'-0\" x 7'-0\" Door" not just "Door")`,
  },
  {
    type: "volume",
    label: "Earthwork & Volumes",
    prompt: `You are a construction quantity surveyor analyzing a plan drawing.
Return ONLY raw JSON starting with { — no prose, no markdown, no code fences.
Coordinates: x,y as PERCENTAGE of image (0=left/top, 100=right/bottom).

TASK: Identify every VOLUMETRIC item requiring excavation, fill, or mass earthwork.
Include: building excavations, footing trenches, retention/detention basins, grading cut zones, fill zones, pond excavations, spread footings (if depth shown).
If NO earthwork is visible on this sheet, return {"items":[]}.

Return:
{
  "items": [
    {
      "type": "volume",
      "label": "Building Pad Excavation",
      "unit": "CY",
      "points": [[x,y],[x,y],[x,y],[x,y]],
      "depth_ft": 4.0,
      "material": "Earth",
      "notes": "cut/fill depth or note from drawing"
    }
  ]
}

Rules:
- Polygon must have 3+ points tracing the excavation footprint
- depth_ft: actual numeric depth in feet if printed on drawing, otherwise null
- material: "Earth", "Rock", "Gravel", "Clay", or "Mixed" — only if labeled on drawing`,
  },
];

// ─── Analysis prompt ──────────────────────────────────────────────
function buildAnalysisPrompt(items, meta) {
  const byType = {};
  for (const it of items) {
    if (!byType[it.type]) byType[it.type] = [];
    byType[it.type].push(it);
  }

  const lines = items.map(it => {
    const pts = it.points?.length || 0;
    const detail = it.depth_ft ? ` | depth: ${it.depth_ft}ft` : "";
    const note = it.notes ? ` | ${it.notes}` : "";
    return `  [${it.type.toUpperCase()}] ${it.label}${detail}${note} (${pts} point${pts !== 1 ? "s" : ""})`;
  }).join("\n");

  return `You are a senior construction estimator in Dallas/Fort Worth Texas reviewing an AI-generated plan takeoff.

TAKEOFF DATA:
Sheet: ${meta.sheet || "Not identified"}
Scale: ${meta.scale || "Not identified"}
Total items: ${items.length}
  - Areas (SF): ${byType.area?.length || 0} items
  - Lengths (LF): ${byType.length?.length || 0} items
  - Counts (EA): ${byType.count?.length || 0} items
  - Volumes (CY): ${byType.volume?.length || 0} items

ITEMS:
${lines}

Write a comprehensive takeoff analysis report. Structure it as follows:

## Project Scope
[What type of project this appears to be based on the items found]

## Key Quantities
[Highlight the most significant items by category — the items that will drive cost]

## Notable Observations
[Anything that stands out: unusually large areas, missing data, items that need field verification]

## Potential Gaps
[What might be missing from this takeoff — items commonly found on this type of project that weren't identified]

## Estimator Notes
[Any DFW-specific considerations, phasing concerns, or items to flag for the PM]

Be specific, concise, and professional. 300–500 words.`;
}

// ─── Contact extraction prompt ────────────────────────────────────
const CONTACTS_PROMPT = `You are reading a construction plan drawing (title block, stamp area, or cover sheet).

Extract ALL contact information visible on this drawing. Look for:
- Architect / Architecture firm
- Structural Engineer / MEP Engineer
- Civil Engineer
- Owner / Developer / Client
- General Contractor
- Consultants
- Project Manager contact info
- Any phone numbers, emails, addresses visible in the title block or stamp area

Return ONLY raw JSON:
{
  "project_name": "project name if visible",
  "contacts": [
    {
      "name": "Person or firm name",
      "title": "Architect | Engineer | Owner | GC | PM | Inspector | Other",
      "type": "architect | engineer | owner | gc | client | inspector | other",
      "company": "Firm/company name if different from name",
      "phone": "phone if visible",
      "email": "email if visible",
      "address": "office address if visible",
      "license": "license number if visible",
      "notes": "any other relevant info"
    }
  ]
}

If no contacts are visible, return {"contacts":[]}.
Only include contacts with at least a name or company.`;

// ─── Extract contacts from a plan image ──────────────────────────
export async function extractPlanContacts(cfg, rasterPath) {
  try {
    const pngBase64 = fs.readFileSync(rasterPath).toString("base64");
    const raw = await visionRead(cfg, pngBase64, CONTACTS_PROMPT);
    const result = repairJSON(raw);
    return {
      projectName: result.project_name || null,
      contacts: (result.contacts || []).filter(c => c.name || c.company),
    };
  } catch (e) {
    console.warn("[extractPlanContacts] error:", e.message);
    return { projectName: null, contacts: [] };
  }
}

// ─── Main export ──────────────────────────────────────────────────
export async function autoTakeoffChunked(cfg, rasterPath, onProgress) {
  const pngBase64 = fs.readFileSync(rasterPath).toString("base64");
  const allItems = [];
  const meta = {};

  for (let i = 0; i < PASSES.length; i++) {
    const pass = PASSES[i];
    onProgress({ type: "pass_start", pass: i + 1, total: PASSES.length + 1, label: pass.label });

    let items = [];
    try {
      const raw = await visionRead(cfg, pngBase64, pass.prompt);
      const result = repairJSON(raw);
      if (!meta.sheet && result.sheet) meta.sheet = result.sheet;
      if (!meta.scale && result.scale) meta.scale = result.scale;
      items = (result.items || []).filter(it => it && it.type === pass.type && Array.isArray(it.points) && it.points.length > 0);
    } catch (e) {
      console.warn(`[autoTakeoff] Pass "${pass.label}" error:`, e.message);
    }

    allItems.push(...items);
    onProgress({ type: "pass_done", pass: i + 1, label: pass.label, items, running: allItems.length });
  }

  // Contacts extraction pass
  onProgress({ type: "pass_start", pass: PASSES.length + 1, total: PASSES.length + 1, label: "Title Block Contacts" });
  let extractedContacts = [];
  try {
    const cr = await extractPlanContacts(cfg, rasterPath);
    extractedContacts = cr.contacts || [];
    if (cr.projectName && !meta.projectName) meta.projectName = cr.projectName;
  } catch (e) {
    console.warn("[autoTakeoff] Contacts pass error:", e.message);
  }
  onProgress({ type: "contacts_done", contacts: extractedContacts });

  // Analysis pass
  onProgress({ type: "analyzing", total: allItems.length });
  let analysis = `Takeoff complete — ${allItems.length} items identified across 4 passes.`;
  try {
    analysis = await chatText(cfg,
      "You are a senior construction estimator in Dallas-Fort Worth Texas. Write professional, concise reports.",
      [{ role: "user", content: buildAnalysisPrompt(allItems, meta) }]
    );
  } catch (e) {
    console.warn("[autoTakeoff] Analysis pass error:", e.message);
  }

  onProgress({ type: "done", total: allItems.length, analysis, meta });
  return { ...meta, items: allItems, analysis, contacts: extractedContacts };
}

// Legacy single-shot (kept for backward compat)
export async function autoTakeoff(cfg, rasterPath) {
  const items = [];
  await autoTakeoffChunked(cfg, rasterPath, (ev) => {
    if (ev.type === "pass_done") items.push(...ev.items);
  });
  return { items };
}
