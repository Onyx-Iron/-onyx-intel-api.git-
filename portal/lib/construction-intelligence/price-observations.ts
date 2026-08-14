import { z } from "zod";
import { PRICE_SOURCE_PRECEDENCE } from "./pricing";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");
const money = z.coerce.number().finite().nonnegative().default(0);

const observationSchema = z.object({
  project_id: z.string().uuid().nullable().optional(),
  trade_key: z.string().trim().min(1).max(100).nullable().optional(),
  cost_code: z.string().trim().min(1).max(50).nullable().optional(),
  description: z.string().trim().min(3).max(500),
  source_kind: z.enum(PRICE_SOURCE_PRECEDENCE),
  source_ref: z.string().trim().max(500).nullable().optional(),
  effective_date: date,
  expires_at: date.nullable().optional(),
  country_code: z.string().trim().length(2).toUpperCase().default("US"),
  state_code: z.string().trim().length(2).toUpperCase().nullable().optional(),
  metro_code: z.string().trim().min(1).max(50).toUpperCase().nullable().optional(),
  postal_code: z.string().trim().min(3).max(12).nullable().optional(),
  unit: z.string().trim().min(1).max(30).toUpperCase(),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  labor_cost: money,
  material_cost: money,
  equipment_cost: money,
  subcontract_cost: money,
  other_cost: money,
  tax_cost: money,
  freight_cost: money,
  waste_cost: money,
  escalation_cost: money,
  confidence: z.coerce.number().finite().min(0).max(1).default(0),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
}).superRefine((value, context) => {
  if (value.source_kind !== "ai_estimate" && !value.source_ref) {
    context.addIssue({ code: "custom", path: ["source_ref"], message: "A source reference is required for non-AI price evidence" });
  }
  if (value.source_kind === "project_quote" && !value.project_id) {
    context.addIssue({ code: "custom", path: ["project_id"], message: "A project quote must belong to a project" });
  }
  const total = value.labor_cost + value.material_cost + value.equipment_cost + value.subcontract_cost
    + value.other_cost + value.tax_cost + value.freight_cost + value.waste_cost + value.escalation_cost;
  if (total <= 0) context.addIssue({ code: "custom", path: ["labor_cost"], message: "At least one positive cost component is required" });
  if (value.expires_at && value.expires_at < value.effective_date) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "Expiration cannot precede the effective date" });
  }
});

export type PriceObservationInput = z.infer<typeof observationSchema> & { approval_status: "unreviewed" };

export function parsePriceObservationInput(input: unknown): PriceObservationInput {
  const parsed = observationSchema.parse(input);
  return { ...parsed, approval_status: "unreviewed" };
}
