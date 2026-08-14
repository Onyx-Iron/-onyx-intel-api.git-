import { z } from "zod";

export const BID_OPPORTUNITY_STAGES = [
  "lead",
  "qualifying",
  "bidding",
  "submitted",
  "shortlisted",
  "won",
  "lost",
  "no_bid",
] as const;

export const BID_OPPORTUNITY_PRIORITIES = ["low", "medium", "high", "critical"] as const;

const optionalText = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().trim().max(10_000).nullable().optional(),
);

const optionalMoney = z.preprocess(
  (value) => (value === "" || value == null ? null : Number(value)),
  z.number().nonnegative().nullable().optional(),
);

const optionalPercent = z.preprocess(
  (value) => (value === "" || value == null ? null : Number(value)),
  z.number().min(0).max(100).nullable().optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").nullable().optional(),
);

const optionalUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional(),
);

export const bidOpportunityCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  client_name: optionalText,
  source: optionalText,
  stage: z.enum(BID_OPPORTUNITY_STAGES).optional(),
  priority: z.enum(BID_OPPORTUNITY_PRIORITIES).optional(),
  bid_due_date: optionalDate,
  estimated_value: optionalMoney,
  win_probability: optionalPercent,
  location: optionalText,
  scope_summary: optionalText,
  next_action: optionalText,
  owner: optionalText,
  notes: optionalText,
  linked_project_id: optionalUuid,
  linked_estimate_version_id: optionalUuid,
});

export const bidOpportunityUpdateSchema = bidOpportunityCreateSchema.partial();

export function validationMessage(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join(".")}: ${first.message}` : "Invalid request body";
}
