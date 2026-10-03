import catalog from "./csi-divisions.json";

export interface CsiDivision {
  code: string;
  name: string;
}

export interface CsiSection {
  code: string;
  division: string;
  name: string;
}

const divisions = catalog.divisions as CsiDivision[];
const sections = catalog.sections as CsiSection[];

export function listCsiDivisions(): CsiDivision[] {
  return divisions;
}

export function listCsiSections(division?: string): CsiSection[] {
  if (!division) return sections;
  const prefix = division.replace(/\D/g, "").slice(0, 2);
  return sections.filter((section) => section.division === prefix);
}

export function lookupCsi(code: string | null | undefined): { division: CsiDivision | null; section: CsiSection | null } {
  if (!code) return { division: null, section: null };
  const digits = code.replace(/\D/g, "");
  const divisionCode = digits.slice(0, 2);
  const normalized = digits.length >= 6
    ? `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
    : code.trim();
  return {
    division: divisions.find((division) => division.code === divisionCode) ?? null,
    section: sections.find((section) => section.code === normalized) ?? null,
  };
}

export const ESTIMATE_LINE_TYPES = ["material", "labour", "subcontract", "equipment", "fee", "allowance"] as const;
export type EstimateLineType = (typeof ESTIMATE_LINE_TYPES)[number];

export function normalizeLineType(value: string | null | undefined): EstimateLineType {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "labor") return "labour";
  if (raw === "sub") return "subcontract";
  if ((ESTIMATE_LINE_TYPES as readonly string[]).includes(raw)) return raw as EstimateLineType;
  return "material";
}
