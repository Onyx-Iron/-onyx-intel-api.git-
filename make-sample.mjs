// Generates examples/sample-plans.pdf — a 3-sheet set for testing.
// Run: node make-sample.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("examples/sample-plans.pdf");
if (!fs.existsSync("examples")) fs.mkdirSync("examples");

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.HelveticaBold);
const mono = await doc.embedFont(StandardFonts.Courier);

function addSheet(title, sheetNum, lines) {
  const page = doc.addPage([1056, 816]); // 11x8.5 landscape at 96dpi
  const { width, height } = page.getSize();

  // Background
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });

  // Border
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40,
    borderColor: rgb(0, 0, 0), borderWidth: 2, color: rgb(0.97, 0.97, 0.97) });

  // Title block (bottom right)
  const tbX = width - 280, tbY = 20, tbW = 260, tbH = 80;
  page.drawRectangle({ x: tbX, y: tbY, width: tbW, height: tbH,
    borderColor: rgb(0, 0, 0), borderWidth: 1.5, color: rgb(1, 1, 1) });
  page.drawText("ONYX & IRON CONSTRUCTION", { x: tbX + 8, y: tbY + 58, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(title, { x: tbX + 8, y: tbY + 42, size: 11, font, color: rgb(0, 0, 0) });
  page.drawText(`Sheet: ${sheetNum}`, { x: tbX + 8, y: tbY + 26, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText("Project: Sample Office Building", { x: tbX + 8, y: tbY + 12, size: 8, font, color: rgb(0.3, 0.3, 0.3) });

  // Sheet number (top right)
  page.drawText(sheetNum, { x: width - 90, y: height - 50, size: 28, font, color: rgb(0.15, 0.15, 0.15) });

  // Content lines
  lines.forEach((line, i) => {
    page.drawText(line, { x: 50, y: height - 80 - i * 18, size: 10, font: mono, color: rgb(0.1, 0.1, 0.1) });
  });
}

addSheet("FOUNDATION PLAN", "A-101", [
  "FOUNDATION PLAN — SCALE: 1/8\" = 1'-0\"",
  "",
  "GENERAL NOTES:",
  "1. ALL CONCRETE: f'c = 4,000 PSI @ 28 DAYS",
  "2. ALL REBAR: ASTM A615 GRADE 60",
  "3. CONTINUOUS FOOTINGS: 2'-0\" WIDE x 1'-0\" DEEP",
  "4. COLUMN FOOTINGS: SEE SCHEDULE BELOW",
  "5. CONCRETE COVER: 3\" MIN AT FOOTINGS",
  "6. VAPOR BARRIER: 6-MIL POLY UNDER ALL SLABS",
  "7. SLAB ON GRADE: 5\" THICK, 4,000 PSI, W/ 6x6 W2.9xW2.9 WWF",
  "",
  "COLUMN FOOTING SCHEDULE:",
  "  MARK    SIZE        DEPTH    REBAR",
  "  CF-1    4'-0\"x4'-0\" 1'-6\"   (4) #6 E.W.",
  "  CF-2    5'-0\"x5'-0\" 1'-8\"   (5) #6 E.W.",
  "  CF-3    6'-0\"x6'-0\" 2'-0\"   (6) #7 E.W.",
  "",
  "EXCAVATION NOTES:",
  "  OVER-EXCAVATE 12\" BELOW FOOTING ELEVATION",
  "  COMPACT SUBGRADE TO 95% MODIFIED PROCTOR",
  "  PLACE 6\" COMPACTED GRAVEL BASE",
  "",
  "DIMENSIONS:",
  "  BUILDING FOOTPRINT: 120'-0\" x 80'-0\"",
  "  PERIMETER FOOTING: 396 LF (TOTAL)",
  "  SLAB AREA: 9,600 SF",
]);

addSheet("DOOR & WINDOW SCHEDULE", "A-201", [
  "DOOR & WINDOW SCHEDULE",
  "",
  "DOOR SCHEDULE:",
  "  MARK  WIDTH  HEIGHT  TYPE    MATERIAL   HARDWARE   FIRE RATING",
  "  D-1   3'-0\"  7'-0\"   SWING   HM/GLASS   HW-A       20-MIN",
  "  D-2   3'-0\"  7'-0\"   SWING   HM         HW-A       20-MIN",
  "  D-3   6'-0\"  7'-0\"   DOUBLE  ALUM/GLASS HW-B       NONE",
  "  D-4   3'-6\"  7'-0\"   SWING   HM         HW-C       90-MIN",
  "  D-5   4'-0\"  7'-0\"   SLIDE   ALUM/GLASS HW-B       NONE",
  "",
  "  TOTAL DOORS: 24 EA",
  "  HM DOORS: 18 EA",
  "  ALUM/GLASS: 6 EA",
  "",
  "WINDOW SCHEDULE:",
  "  MARK  WIDTH  HEIGHT  TYPE    GLAZING       U-FACTOR",
  "  W-1   3'-0\"  4'-0\"   FIXED   INSUL DBL     0.29",
  "  W-2   4'-0\"  5'-0\"   CASEMENT INSUL DBL   0.29",
  "  W-3   6'-0\"  6'-0\"   FIXED   LOW-E DBL     0.26",
  "  W-4   2'-0\"  3'-0\"   AWNING  INSUL DBL     0.30",
  "",
  "  TOTAL WINDOWS: 48 EA",
  "  GLAZING AREA: 1,440 SF (APPROX)",
  "",
  "HARDWARE GROUPS:",
  "  HW-A: LEVER HANDLE, DEADBOLT, CLOSER, KICK PLATE",
  "  HW-B: PUSH/PULL, CLOSER, THRESHOLD",
  "  HW-C: PANIC HARDWARE, CLOSER, DEADBOLT",
]);

addSheet("WALL SECTIONS", "S-301", [
  "STRUCTURAL WALL SECTIONS — SCALE: 1/4\" = 1'-0\"",
  "",
  "EXTERIOR WALL ASSEMBLY (TYPE EW-1):",
  "  - 4\" BRICK VENEER",
  "  - 1\" AIR SPACE",
  "  - BUILDING WRAP",
  "  - 5/8\" OSB SHEATHING",
  "  - 6\" METAL STUD @ 16\" O.C. (600S162-54)",
  "  - R-21 BATT INSULATION",
  "  - 5/8\" TYPE-X GWB (INTERIOR)",
  "  TOTAL THICKNESS: 13\" NOM",
  "",
  "INTERIOR PARTITION (TYPE IW-1):",
  "  - 5/8\" GWB EACH SIDE",
  "  - 3-5/8\" METAL STUD @ 16\" O.C.",
  "  - R-11 BATT INSULATION",
  "  TOTAL THICKNESS: 4-7/8\"",
  "",
  "STRUCTURAL NOTES:",
  "  ALL STUDS: ASTM A653 GRADE 33 MIN",
  "  DEFLECTION LIMIT: L/360 LIVE, L/240 TOTAL",
  "  WIND SPEED: 115 MPH (EXPOSURE C)",
  "  SEISMIC: SDC B",
  "",
  "QUANTITIES (APPROX):",
  "  EXTERIOR WALL: 2,480 SF",
  "  INTERIOR PARTITIONS: 8,640 SF",
  "  BRICK VENEER: 2,480 SF",
  "  METAL STUDS (6\"): 2,480 LF",
  "  METAL STUDS (3-5/8\"): 8,640 LF",
]);

const bytes = await doc.save();
fs.writeFileSync(out, bytes);
console.log(`✓ Sample plans written to ${out} (${Math.round(bytes.length / 1024)} KB, 3 sheets)`);
