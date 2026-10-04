import { projectSectionHref } from "../../navigation/project-sections";

export type PinKind = "punch" | "rfi";

export interface SheetPinInput {
  note: string;
  kind: PinKind;
  pageNumber: number;
  point: { x: number; y: number };
  sheetName?: string | null;
  projectId: string;
}

export interface SheetPinPayload {
  markup_type: "pin";
  label: string;
  href: string;
  geometry: {
    coordinate_space: "page_space";
    point: { x: number; y: number };
    page_number: number;
    kind: PinKind;
  };
  punch?: { description: string; location: string };
  rfi?: { subject: string; description: string };
}

/** A pin note becomes a punch item or an RFI. The page number is part of that record. */
export function buildSheetPin(input: SheetPinInput): SheetPinPayload | null {
  const note = input.note.trim();
  if (!note) return null;
  if (!Number.isFinite(input.pageNumber) || input.pageNumber < 1) return null;
  const pageLabel = `Page ${input.pageNumber}`;
  const location = input.sheetName?.trim()
    ? `${input.sheetName.trim()}, ${pageLabel}`
    : pageLabel;
  const geometry = {
    coordinate_space: "page_space" as const,
    point: input.point,
    page_number: input.pageNumber,
    kind: input.kind,
  };
  if (input.kind === "punch") {
    return {
      markup_type: "pin",
      label: note,
      href: projectSectionHref(input.projectId, "closeout", "punchlist"),
      geometry,
      punch: { description: note, location },
    };
  }
  return {
    markup_type: "pin",
    label: note,
    href: projectSectionHref(input.projectId, "controls", "controls"),
    geometry,
    rfi: {
      subject: note,
      description: `${pageLabel}. ${note}`,
    },
  };
}
