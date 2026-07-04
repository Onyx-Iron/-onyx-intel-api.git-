/**
 * CAD layer → takeoff intent classifier.
 *
 * Maps AIA/NCS-style civil/architectural layer names to structured
 * takeoff hints: takeoff_type (count / length / area), unit, cost code,
 * a human-friendly description, and a match confidence [0..1].
 *
 * Layer names are extremely non-standard across firms, so this uses tiered
 * pattern matching:
 *   Tier 1 (0.92+): exact AIA/NCS discipline+minor prefix match
 *   Tier 2 (0.75..0.90): strong keyword hit
 *   Tier 3 (0.55..0.70): weak or generic keyword
 *   Miss (0.30): no signal — surface as "unknown vector"
 */

export type CADIntent = "length" | "area" | "count";

export interface LayerClassification {
  takeoff_type: CADIntent;
  unit: "LF" | "SF" | "EA";
  cost_code?: string;
  description: string;         // human-friendly, drops into estimate row
  color: string;               // hex, for the vector overlay
  confidence: number;          // 0..1
}

interface Rule {
  test: (raw: string) => boolean;
  hit: LayerClassification;
}

const norm = (s: string) => s.toUpperCase().replace(/[_\s]+/g, "-").trim();

// ── Rule table. Order matters — first match wins. ──────────────────────────
const RULES: Rule[] = [
  // Civil — Sanitary sewer
  {
    test: (l) => /^(C-)?(SSWR|SS-PIPE|SAN-SWR|SANITARY)/.test(l) || (/SANITARY/.test(l) && /SEWER|PIPE/.test(l)),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "33-31-00",
      description: "8-inch sanitary sewer utility pipe routing",
      color: "#8B5CF6", confidence: 0.92,
    },
  },
  // Civil — Storm drain
  {
    test: (l) => /^(C-)?(STRM|STORM|SD-PIPE|C-SD)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "33-40-00",
      description: "Storm drainage pipe",
      color: "#0EA5E9", confidence: 0.90,
    },
  },
  // Civil — Water main
  {
    test: (l) => /^(C-)?(WATR|WATER|W-MAIN|DOMWTR)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "33-11-00",
      description: "Water main / domestic water piping",
      color: "#06B6D4", confidence: 0.90,
    },
  },
  // Civil — Paving / asphalt
  {
    test: (l) => /^(C-)?(PAVE|PAVING|ASPH|HMA)/.test(l),
    hit: {
      takeoff_type: "area", unit: "SF", cost_code: "32-12-16",
      description: "Asphalt paving",
      color: "#4B5563", confidence: 0.88,
    },
  },
  // Civil — Concrete flatwork / walks
  {
    test: (l) => /^(C-)?(SWLK|WALK|CONC-FLAT|SIDEWALK)/.test(l),
    hit: {
      takeoff_type: "area", unit: "SF", cost_code: "32-13-13",
      description: "Concrete sidewalk / flatwork",
      color: "#D4D4D8", confidence: 0.86,
    },
  },
  // Civil — Curb & gutter
  {
    test: (l) => /^(C-)?(CURB|C&G|CURB-GTR)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "32-16-13",
      description: "Concrete curb & gutter",
      color: "#F59E0B", confidence: 0.88,
    },
  },
  // Civil — Grading / topo contour
  {
    test: (l) => /^(C-)?(TOPO|CONT|CONTOUR|GRAD|EGCONT|PGCONT)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "31-22-13",
      description: "Site grading contour",
      color: "#84CC16", confidence: 0.70,
    },
  },
  // Civil — Property line / boundary
  {
    test: (l) => /^(C-)?(PROP|BNDRY|BOUNDARY|LOT-LINE)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF",
      description: "Property boundary",
      color: "#EF4444", confidence: 0.85,
    },
  },
  // Civil — Erosion control / silt fence
  {
    test: (l) => /^(C-)?(EROS|SILT|SWPPP|ESC-)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "31-25-00",
      description: "Silt fence / erosion control",
      color: "#CA8A04", confidence: 0.82,
    },
  },
  // Landscape — Planting bed
  {
    test: (l) => /^(L-)?(PLNT|PLANT|BED|SHRUB)/.test(l),
    hit: {
      takeoff_type: "area", unit: "SF", cost_code: "32-93-00",
      description: "Planting bed",
      color: "#10B981", confidence: 0.78,
    },
  },
  // Landscape — Turf / sod
  {
    test: (l) => /^(L-)?(TURF|LAWN|SOD)/.test(l),
    hit: {
      takeoff_type: "area", unit: "SF", cost_code: "32-92-00",
      description: "Turf / sod",
      color: "#22C55E", confidence: 0.82,
    },
  },
  // Architectural — Wall
  {
    test: (l) => /^(A-)?(WALL|WALL-INT|WALL-EXT|PARTITION)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "09-21-00",
      description: "Interior partition wall",
      color: "#DC2626", confidence: 0.80,
    },
  },
  // Architectural — Door
  {
    test: (l) => /^(A-)?(DOOR|DR-|OPENING)/.test(l),
    hit: {
      takeoff_type: "count", unit: "EA", cost_code: "08-14-00",
      description: "Door opening",
      color: "#F97316", confidence: 0.80,
    },
  },
  // Architectural — Window
  {
    test: (l) => /^(A-)?(WIN|WINDOW|GLAZ)/.test(l),
    hit: {
      takeoff_type: "count", unit: "EA", cost_code: "08-50-00",
      description: "Window opening",
      color: "#38BDF8", confidence: 0.80,
    },
  },
  // Architectural — Floor / slab area
  {
    test: (l) => /^(A-)?(FLOR|SLAB|CONC-SLAB)/.test(l),
    hit: {
      takeoff_type: "area", unit: "SF", cost_code: "03-30-00",
      description: "Concrete slab / floor",
      color: "#A78BFA", confidence: 0.82,
    },
  },
  // Architectural — Roof
  {
    test: (l) => /^(A-)?(ROOF|RFG|ROOFING)/.test(l),
    hit: {
      takeoff_type: "area", unit: "SF", cost_code: "07-31-00",
      description: "Roofing area",
      color: "#EA580C", confidence: 0.78,
    },
  },
  // Structural — Beam / column
  {
    test: (l) => /^(S-)?(BEAM|COL|COLUMN)/.test(l),
    hit: {
      takeoff_type: "count", unit: "EA", cost_code: "05-12-00",
      description: "Structural steel member",
      color: "#7C3AED", confidence: 0.80,
    },
  },
  // Electrical — Lighting fixtures
  {
    test: (l) => /^(E-)?(LITE|LIGHT|FIXT)/.test(l),
    hit: {
      takeoff_type: "count", unit: "EA", cost_code: "26-51-00",
      description: "Lighting fixture",
      color: "#EAB308", confidence: 0.78,
    },
  },
  // Electrical — Conduit / raceway
  {
    test: (l) => /^(E-)?(COND|CONDT|RCWY)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "26-05-33",
      description: "Electrical conduit",
      color: "#FBBF24", confidence: 0.80,
    },
  },
  // HVAC duct
  {
    test: (l) => /^(M-)?(DUCT|HVAC|SUPPLY|RETURN)/.test(l),
    hit: {
      takeoff_type: "length", unit: "LF", cost_code: "23-31-00",
      description: "HVAC ductwork",
      color: "#3B82F6", confidence: 0.75,
    },
  },
];

// ── Generic fallbacks by discipline prefix (Tier 3) ────────────────────────
const DISCIPLINE_FALLBACK: Record<string, LayerClassification> = {
  C: { takeoff_type: "length", unit: "LF", description: "Civil linework",         color: "#94A3B8", confidence: 0.45 },
  L: { takeoff_type: "area",   unit: "SF", description: "Landscape area",         color: "#4ADE80", confidence: 0.45 },
  A: { takeoff_type: "length", unit: "LF", description: "Architectural linework", color: "#F87171", confidence: 0.45 },
  S: { takeoff_type: "length", unit: "LF", description: "Structural linework",    color: "#A855F7", confidence: 0.45 },
  E: { takeoff_type: "length", unit: "LF", description: "Electrical linework",    color: "#FACC15", confidence: 0.45 },
  M: { takeoff_type: "length", unit: "LF", description: "Mechanical linework",    color: "#60A5FA", confidence: 0.45 },
  P: { takeoff_type: "length", unit: "LF", description: "Plumbing linework",      color: "#22D3EE", confidence: 0.45 },
};

export function classifyLayer(rawLayer: string): LayerClassification {
  const layer = norm(rawLayer);

  for (const rule of RULES) {
    if (rule.test(layer)) return rule.hit;
  }

  const discipline = layer.split("-", 1)[0];
  if (discipline && DISCIPLINE_FALLBACK[discipline]) {
    return DISCIPLINE_FALLBACK[discipline];
  }

  return {
    takeoff_type: "length", unit: "LF",
    description: `Unclassified linework (${rawLayer})`,
    color: "#6B7280", confidence: 0.30,
  };
}
