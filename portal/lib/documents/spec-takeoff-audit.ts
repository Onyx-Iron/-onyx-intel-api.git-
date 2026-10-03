const CSI_WITH_SEPARATOR = /\b(\d{2})[\s-](\d{2})[\s-](\d{2})\b/g;

export interface SpecChunk {
  document_id: string;
  page_number: number | null;
  content: string;
  file_name?: string | null;
}

export interface SpecGap {
  code: string;
  documentId: string;
  fileName: string | null;
  pageNumber: number | null;
  excerpt: string;
}

export function normalizeCsi(code: string): string {
  return code.replace(/\D/g, "");
}

/** MasterFormat codes written with spaces or hyphens. Divisions above 49 are ignored. */
export function extractCsiCodes(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(CSI_WITH_SEPARATOR)) {
    const division = Number(match[1]);
    if (!Number.isInteger(division) || division > 49) continue;
    found.add(`${match[1]} ${match[2]} ${match[3]}`);
  }
  return [...found];
}

/**
 * Spec sections that name a CSI code the takeoff does not contain.
 * One hit per code. The excerpt is the surrounding spec text, not a generated quantity.
 */
export function specCodesMissingFromTakeoff(chunks: SpecChunk[], takeoffCodes: string[]): SpecGap[] {
  const present = new Set(takeoffCodes.map(normalizeCsi).filter((code) => code.length > 0));
  const gaps: SpecGap[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const code of extractCsiCodes(chunk.content)) {
      const key = normalizeCsi(code);
      if (present.has(key) || seen.has(key)) continue;
      seen.add(key);
      const at = chunk.content.search(new RegExp(code.replace(/ /g, "[\\s-]")));
      const start = at >= 0 ? Math.max(0, at - 48) : 0;
      const excerpt = chunk.content.slice(start, start + 140).replace(/\s+/g, " ").trim();
      gaps.push({
        code,
        documentId: chunk.document_id,
        fileName: chunk.file_name ?? null,
        pageNumber: chunk.page_number,
        excerpt,
      });
    }
  }
  return gaps;
}

export function draftSpecRfi(gaps: SpecGap[]): { subject: string; body: string } {
  const first = gaps[0];
  const where = first?.fileName
    ? `${first.fileName}${first.pageNumber != null ? `, page ${first.pageNumber}` : ""}`
    : "the project specifications";
  const lines = [
    "To: Design Team",
    "From: Onyx Intel (auto-drafted, pending review)",
    `RE:   ${where}`,
    "",
    "The following CSI sections are named in the specifications and do not appear on the takeoff. Please confirm whether each is in this contract's scope:",
    "",
  ];
  for (const gap of gaps) {
    const cite = gap.fileName
      ? `${gap.fileName}${gap.pageNumber != null ? ` p.${gap.pageNumber}` : ""}`
      : `document ${gap.documentId}`;
    lines.push(`- ${gap.code} (${cite})`);
    if (gap.excerpt) lines.push(`  "${gap.excerpt}"`);
  }
  lines.push("", "This draft is not sent until a reviewer approves it.");
  return {
    subject: `RFI: Spec CSI not on takeoff — ${first?.code ?? "scope"}`,
    body: lines.join("\n"),
  };
}
