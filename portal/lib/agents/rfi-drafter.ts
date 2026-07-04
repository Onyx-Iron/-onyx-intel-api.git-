/**
 * RFI Drafting Agent
 * ---------------------
 * When the parser (or the vision extractor) flags a contradiction between
 * two sources on the same sheet — e.g. structural foundation depths vs.
 * civil piping elevations, or door schedule counts vs. plan door tags —
 * this agent drafts a clean RFI with precise sheet/page citations.
 *
 * Invariant: drafts are ALWAYS written as `ai_agent_audit_trails` rows
 * with status `pending_human_review`. The RFI is never sent externally
 * until a human clicks Approve.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAnyClient = any;

interface VisionItem {
  description: string;
  quantity: number;
  unit: string;
  cost_code?: string;
  layer_hint?: string;
  source: "schedule" | "note" | "callout" | "image" | "text";
  confidence: number;
  raw_text?: string;
}

interface RunArgs {
  db: SupabaseAnyClient;
  tenantId: string;
  projectId: string;
  pageId: string;
  pageNumber: number;
  documentId: string | null;
  documentName: string | null;
  visionItems: VisionItem[];
}

interface Contradiction {
  a: { source: string; text: string; quantity?: number; unit?: string };
  b: { source: string; text: string; quantity?: number; unit?: string };
  reason: string;
  discipline: string;
}

/**
 * Simple heuristic contradiction finder:
 *   - Same discipline keyword (e.g. "foundation", "grade", "elevation", "sewer",
 *     "invert") in two vision items
 *   - Different numeric values (elevations, sizes, counts) → contradiction
 *   - Different quantities for the same item type → contradiction
 *
 * The real value here is the CITATION FORMAT — every contradiction becomes
 * an RFI that quotes the source strings verbatim and cites the sheet.
 */
const DISCIPLINE_KEYS: Array<{ key: string; label: string }> = [
  { key: "foundation", label: "Foundation" },
  { key: "elev",       label: "Elevation" },
  { key: "invert",     label: "Invert elevation" },
  { key: "footing",    label: "Footing" },
  { key: "grade",      label: "Grade / grading" },
  { key: "sewer",      label: "Sanitary sewer" },
  { key: "storm",      label: "Storm drainage" },
  { key: "water",      label: "Water main" },
  { key: "door",       label: "Door schedule" },
  { key: "window",     label: "Window schedule" },
  { key: "fixture",    label: "Fixture count" },
];

function extractElevation(txt: string): number | null {
  // "INV EL 972.50", "FF EL 100.00", "482.15'", "ELEV 1234.5"
  const m = txt.match(/(-?\d{1,4}(?:\.\d{1,3})?)/);
  return m ? Number(m[1]) : null;
}

export async function runRfiDrafterAgent({ db, tenantId, projectId, pageId, pageNumber, documentId, documentName, visionItems }: RunArgs): Promise<{ drafted: number }> {
  const contradictions: Contradiction[] = [];

  for (const { key, label } of DISCIPLINE_KEYS) {
    const hits = visionItems.filter((v) =>
      v.description.toLowerCase().includes(key) ||
      (v.raw_text ?? "").toLowerCase().includes(key),
    );
    if (hits.length < 2) continue;

    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i], b = hits[j];
        const aNum = extractElevation(a.raw_text ?? a.description);
        const bNum = extractElevation(b.raw_text ?? b.description);
        if (aNum != null && bNum != null && Math.abs(aNum - bNum) > 0.5 && a.source !== b.source) {
          contradictions.push({
            discipline: label,
            reason: `Two ${label.toLowerCase()} values on the same sheet from different sources differ by ${Math.abs(aNum - bNum).toFixed(2)} ft`,
            a: { source: a.source, text: a.raw_text ?? a.description, quantity: aNum },
            b: { source: b.source, text: b.raw_text ?? b.description, quantity: bNum },
          });
        }

        // Quantity contradictions (e.g., 12 doors in schedule but 15 in note)
        if (a.unit === b.unit && a.unit === "EA" && a.quantity && b.quantity && a.quantity !== b.quantity && a.source !== b.source) {
          contradictions.push({
            discipline: label,
            reason: `${label} count differs between ${a.source} (${a.quantity}) and ${b.source} (${b.quantity})`,
            a: { source: a.source, text: a.raw_text ?? a.description, quantity: a.quantity, unit: a.unit },
            b: { source: b.source, text: b.raw_text ?? b.description, quantity: b.quantity, unit: b.unit },
          });
        }
      }
    }
  }

  if (contradictions.length === 0) return { drafted: 0 };

  const rfiDraft = draftRfi({
    projectPageCitation: documentName ? `${documentName}, page ${pageNumber}` : `Page ${pageNumber}`,
    contradictions,
  });

  const { error } = await db.from("ai_agent_audit_trails").insert([{
    tenant_id: tenantId,
    project_id: projectId,
    document_id: documentId,
    page_id: pageId,
    agent_name: "rfi_drafter",
    execution_trigger: "vision_extractions_updated",
    finding_summary:
      `${contradictions.length} contradiction${contradictions.length === 1 ? "" : "s"} found on ${documentName ?? "this sheet"} p.${pageNumber} — RFI drafted.`,
    recommendations: {
      action: "send_rfi",
      contradictions,
      draft: rfiDraft,
    },
    severity: "critical",
    status: "pending_human_review",
  }]);
  if (error) throw new Error(`insert rfi audit: ${error.message}`);
  return { drafted: contradictions.length };
}

function draftRfi(args: { projectPageCitation: string; contradictions: Contradiction[] }): { subject: string; body: string } {
  const first = args.contradictions[0];
  const subject = `RFI: Clarification needed — ${first.discipline} discrepancy on ${args.projectPageCitation}`;
  const lines: string[] = [
    "To: Design Team",
    "From: Onyx Intel (auto-drafted, pending review)",
    `RE:   ${args.projectPageCitation}`,
    "",
    "We identified the following contradiction(s) on this sheet that need clarification before scope pricing can proceed:",
    "",
  ];
  args.contradictions.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.discipline} — ${c.reason}`);
    lines.push(`   • Source A (${c.a.source}): "${c.a.text.slice(0, 240)}"`);
    lines.push(`   • Source B (${c.b.source}): "${c.b.text.slice(0, 240)}"`);
    lines.push("");
  });
  lines.push("Please advise which value governs so we can finalize the estimate.");
  lines.push("");
  lines.push("Suggested resolution: confirm the governing document / issue an addendum aligning the two sources.");
  lines.push("");
  lines.push("— Auto-drafted by Onyx Intel · pending human approval before dispatch.");
  return { subject, body: lines.join("\n") };
}
