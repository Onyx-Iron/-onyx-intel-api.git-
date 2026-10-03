import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ProposalExportLine {
  code: string;
  description: string;
  quantity: number;
  unit: string;
  total: number;
}

export interface ProposalExportInput {
  projectName: string;
  versionLabel: string;
  preview: boolean;
  lines: ProposalExportLine[];
  total: number;
  budgetLines: ProposalExportLine[];
}

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function buildProposalPdf(input: ProposalExportInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = rgb(0.42, 0.55, 0);
  let page = pdf.addPage([612, 792]);
  let y = 750;

  const newPage = () => {
    page = pdf.addPage([612, 792]);
    y = 750;
  };
  const ensure = (height: number) => {
    if (y - height < 48) newPage();
  };
  const write = (text: string, size: number, face: typeof font, color = rgb(0.1, 0.1, 0.1)) => {
    ensure(size + 6);
    page.drawText(text.slice(0, 110), { x: 48, y, size, font: face, color });
    y -= size + 6;
  };

  write("ONYX INTEL", 16, bold, brand);
  write(input.preview ? "Draft preview — not an approved proposal" : "Proposal", 12, bold);
  write(input.projectName, 11, font);
  write(input.versionLabel, 10, font, rgb(0.35, 0.35, 0.35));
  y -= 8;
  for (const line of input.lines) {
    write(
      `${line.code || "—"}  ${line.description}  ${line.quantity} ${line.unit}  ${money(line.total)}`,
      9,
      font,
    );
  }
  y -= 6;
  write(`Total  ${money(input.total)}`, 12, bold);
  if (input.budgetLines.length > 0) {
    y -= 10;
    write("Budget snapshot", 12, bold, brand);
    for (const line of input.budgetLines) {
      write(`${line.code || "—"}  ${line.description}  ${money(line.total)}`, 9, font);
    }
  }
  return pdf.save();
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stored (uncompressed) ZIP. Enough for a Word document package. */
export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function paragraph(text: string, bold = false): string {
  const weight = bold ? "<w:b/>" : "";
  return `<w:p><w:r><w:rPr>${weight}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

export function buildProposalDocx(input: ProposalExportInput): Uint8Array {
  const body = [
    paragraph("ONYX INTEL", true),
    paragraph(input.preview ? "Draft preview — not an approved proposal" : "Proposal", true),
    paragraph(input.projectName),
    paragraph(input.versionLabel),
    ...input.lines.map((line) => paragraph(
      `${line.code || "—"}  ${line.description}  ${line.quantity} ${line.unit}  ${money(line.total)}`,
    )),
    paragraph(`Total  ${money(input.total)}`, true),
  ];
  if (input.budgetLines.length > 0) {
    body.push(paragraph("Budget snapshot", true));
    for (const line of input.budgetLines) {
      body.push(paragraph(`${line.code || "—"}  ${line.description}  ${money(line.total)}`));
    }
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const encode = (value: string) => new TextEncoder().encode(value);
  return zipStore([
    { name: "[Content_Types].xml", data: encode(contentTypes) },
    { name: "_rels/.rels", data: encode(rels) },
    { name: "word/document.xml", data: encode(documentXml) },
  ]);
}
