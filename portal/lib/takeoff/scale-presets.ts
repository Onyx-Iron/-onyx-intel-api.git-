export interface ScalePreset {
  label: string;
  family: "architectural" | "engineering";
  /** Real feet represented by one inch on the sheet. */
  feetPerPaperInch: number;
}

export const SCALE_PRESETS: ScalePreset[] = [
  { label: '1/8" = 1\'-0"', family: "architectural", feetPerPaperInch: 8 },
  { label: '1/4" = 1\'-0"', family: "architectural", feetPerPaperInch: 4 },
  { label: '1/2" = 1\'-0"', family: "architectural", feetPerPaperInch: 2 },
  { label: '1" = 1\'-0"', family: "architectural", feetPerPaperInch: 1 },
  { label: '1" = 10\'', family: "engineering", feetPerPaperInch: 10 },
  { label: '1" = 20\'', family: "engineering", feetPerPaperInch: 20 },
  { label: '1" = 30\'', family: "engineering", feetPerPaperInch: 30 },
  { label: '1" = 40\'', family: "engineering", feetPerPaperInch: 40 },
  { label: '1" = 50\'', family: "engineering", feetPerPaperInch: 50 },
  { label: '1" = 100\'', family: "engineering", feetPerPaperInch: 100 },
];

/** PDF page space is points. One inch is 72 points. */
export function pageSpaceFactorForPreset(preset: ScalePreset): number {
  return preset.feetPerPaperInch / 72;
}

export function matchScalePreset(text: string): ScalePreset | null {
  const compact = text.replace(/\s+/g, "");
  for (const preset of SCALE_PRESETS) {
    if (compact.includes(preset.label.replace(/\s+/g, ""))) return preset;
  }
  const arch = compact.match(/(\d+)\/(\d+)"?=1'(?:-0")?/);
  if (arch) {
    const paperInches = Number(arch[1]) / Number(arch[2]);
    if (paperInches > 0) {
      const feet = 1 / paperInches;
      return SCALE_PRESETS.find((preset) => Math.abs(preset.feetPerPaperInch - feet) < 0.05)
        ?? { label: `${arch[1]}/${arch[2]}" = 1'-0"`, family: "architectural", feetPerPaperInch: feet };
    }
  }
  const eng = compact.match(/(\d+(?:\.\d+)?)"?=(\d+)'/);
  if (eng) {
    const feet = Number(eng[2]) / Number(eng[1]);
    if (feet > 0) {
      return SCALE_PRESETS.find((preset) => Math.abs(preset.feetPerPaperInch - feet) < 0.05)
        ?? { label: `${eng[1]}" = ${eng[2]}'`, family: "engineering", feetPerPaperInch: feet };
    }
  }
  return null;
}
