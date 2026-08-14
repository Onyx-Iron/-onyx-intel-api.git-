export type KnowledgeStatus = "draft" | "provisional" | "certified" | "retired";

export interface ConstructionDivision {
  code: string;
  name: string;
  family: string;
}

export const MASTERFORMAT_DIVISIONS: readonly ConstructionDivision[] = [
  { code: "00", name: "Procurement and Contracting Requirements", family: "project requirements" },
  { code: "01", name: "General Requirements", family: "project requirements" },
  { code: "02", name: "Existing Conditions", family: "facility construction" },
  { code: "03", name: "Concrete", family: "facility construction" },
  { code: "04", name: "Masonry", family: "facility construction" },
  { code: "05", name: "Metals", family: "facility construction" },
  { code: "06", name: "Wood, Plastics, and Composites", family: "facility construction" },
  { code: "07", name: "Thermal and Moisture Protection", family: "facility construction" },
  { code: "08", name: "Openings", family: "facility construction" },
  { code: "09", name: "Finishes", family: "facility construction" },
  { code: "10", name: "Specialties", family: "facility construction" },
  { code: "11", name: "Equipment", family: "facility construction" },
  { code: "12", name: "Furnishings", family: "facility construction" },
  { code: "13", name: "Special Construction", family: "facility construction" },
  { code: "14", name: "Conveying Equipment", family: "facility construction" },
  { code: "21", name: "Fire Suppression", family: "facility services" },
  { code: "22", name: "Plumbing", family: "facility services" },
  { code: "23", name: "Heating, Ventilating, and Air Conditioning", family: "facility services" },
  { code: "25", name: "Integrated Automation", family: "facility services" },
  { code: "26", name: "Electrical", family: "facility services" },
  { code: "27", name: "Communications", family: "facility services" },
  { code: "28", name: "Electronic Safety and Security", family: "facility services" },
  { code: "31", name: "Earthwork", family: "site and infrastructure" },
  { code: "32", name: "Exterior Improvements", family: "site and infrastructure" },
  { code: "33", name: "Utilities", family: "site and infrastructure" },
  { code: "34", name: "Transportation", family: "site and infrastructure" },
  { code: "35", name: "Waterway and Marine Construction", family: "site and infrastructure" },
  { code: "40", name: "Process Integration", family: "process equipment" },
  { code: "41", name: "Material Processing and Handling Equipment", family: "process equipment" },
  { code: "42", name: "Process Heating, Cooling, and Drying Equipment", family: "process equipment" },
  { code: "43", name: "Process Gas and Liquid Handling, Purification, and Storage Equipment", family: "process equipment" },
  { code: "44", name: "Pollution and Waste Control Equipment", family: "process equipment" },
  { code: "45", name: "Industry-Specific Manufacturing Equipment", family: "process equipment" },
  { code: "46", name: "Water and Wastewater Equipment", family: "process equipment" },
  { code: "48", name: "Electrical Power Generation", family: "process equipment" },
] as const;

export const MASTERFORMAT_RESERVED_DIVISIONS = ["15", "16", "17", "18", "19", "20", "24", "29", "30", "36", "37", "38", "39", "47", "49"] as const;

export function findDivision(code: string): ConstructionDivision | null {
  const normalized = code.trim().padStart(2, "0").slice(0, 2);
  return MASTERFORMAT_DIVISIONS.find((division) => division.code === normalized) ?? null;
}

export function isAuthoritativeKnowledge(status: KnowledgeStatus, certifiedAt?: string | null): boolean {
  return status === "certified" && Boolean(certifiedAt);
}
