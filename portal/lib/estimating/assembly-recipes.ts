/**
 * Contractor sub-assembly recipe expander.
 *
 * Evaluates assembly_components.formula_expression against driver variables
 * (qty, height_ft, thickness_in, …) and returns child estimate line drafts.
 */

export type RecipeVars = Record<string, number>;

export interface AssemblyComponentRow {
  id?: string;
  item_type: string;
  formula_expression: string;
  cost_code_ref?: string | null;
  description?: string | null;
  unit?: string | null;
  labor_factor?: number | null;
  material_factor?: number | null;
  sort_order?: number | null;
}

export interface ExpandedLine {
  cost_code: string | null;
  description: string;
  quantity: number;
  unit: string;
  labor_unit: number;
  material_unit: number;
  item_type: string;
  formula_expression: string;
  assembly_id?: string;
}

/** Safe arithmetic evaluator — identifiers become vars; only + - * / ( ) and Math.max/min. */
export function evalFormula(expression: string, vars: RecipeVars): number {
  const normalized = expression.trim().toLowerCase();
  if (!normalized) return 0;

  const allowed = /^[0-9.\s+\-*/(),a-z_]+$/;
  if (!allowed.test(normalized)) {
    throw new Error(`Unsafe formula: ${expression}`);
  }

  // Replace max(/min( with Math.max(/Math.min(
  let js = normalized
    .replace(/\bmax\s*\(/g, "Math.max(")
    .replace(/\bmin\s*\(/g, "Math.min(");

  // Bind known vars as number literals (longest keys first).
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(`\\b${key.toLowerCase()}\\b`, "g");
    js = js.replace(re, String(Number(vars[key]) || 0));
  }

  // Any leftover identifier → 0 (missing var)
  js = js.replace(/\b[a-z_][a-z0-9_]*\b/g, (tok) => {
    if (tok === "math" || tok.startsWith("math.")) return tok;
    if (tok === "max" || tok === "min") return tok;
    return "0";
  });

  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${js});`)();
  if (typeof result !== "number" || !Number.isFinite(result)) return 0;
  return Math.round(result * 10000) / 10000;
}

export function expandRecipeComponents(
  components: AssemblyComponentRow[],
  vars: RecipeVars,
  assemblyId?: string,
): ExpandedLine[] {
  const sorted = [...components].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  return sorted.map((c) => {
    const quantity = evalFormula(c.formula_expression, vars);
    return {
      cost_code: c.cost_code_ref ?? null,
      description: c.description || c.item_type,
      quantity,
      unit: (c.unit || "EA").toUpperCase(),
      labor_unit: Number(c.labor_factor) || 0,
      material_unit: Number(c.material_factor) || 0,
      item_type: c.item_type,
      formula_expression: c.formula_expression,
      assembly_id: assemblyId,
    };
  });
}

/** Map common takeoff cost codes / descriptions to built-in recipe keys. */
export function inferRecipeKey(opts: {
  cost_code?: string | null;
  description?: string | null;
  unit?: string | null;
}): string | null {
  const code = (opts.cost_code || "").trim();
  const desc = (opts.description || "").toLowerCase();
  const unit = (opts.unit || "").toUpperCase();

  if (unit === "LF" || /lf|linear/.test(desc)) {
    if (
      code.startsWith("33-") ||
      /\b(pipe|sewer|water main|storm|utility)\b/.test(desc)
    ) {
      return "utility_pipe_lf";
    }
    if (
      code.startsWith("03-") ||
      /\b(concrete wall|cip wall|retaining wall|stem wall)\b/.test(desc)
    ) {
      return "concrete_wall_lf";
    }
  }
  return null;
}
