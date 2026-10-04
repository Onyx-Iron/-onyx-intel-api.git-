import {
  CHANGE_ORDER_FINANCIAL_FIELDS,
  INVOICE_FINANCIAL_FIELDS,
} from "@/lib/project-controls/financial-redaction";
import { PROJECT_SECTIONS, projectSectionHref } from "@/lib/navigation/project-sections";

export interface SkillCitation {
  document_id: string;
  page_number: number;
  similarity: number;
}

export interface SkillContext {
  tenantId: string;
  projectId: string;
  canReadFinancial: boolean;
  citationsOut: SkillCitation[];
  embedText?: (text: string) => Promise<number[]>;
}

interface ChunkRow {
  content: string;
  document_id: string;
  page_number: number;
  similarity: number;
  rrf_score: number;
}

type Db = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: any;
};

const SKILL_TARGETS = {
  search_project_docs: { label: "Documents", slug: "documents", tab: "documents" },
  get_related_specs: { label: "Documents", slug: "documents", tab: "documents" },
  get_documents: { label: "Documents", slug: "documents", tab: "documents" },
  get_open_rfis: { label: "RFIs", slug: "controls", tab: "controls" },
  get_submittals: { label: "Submittals", slug: "controls", tab: "controls" },
  get_change_orders: { label: "Change orders", slug: "controls", tab: "controls" },
  get_schedule_tasks: { label: "Schedule", slug: "schedule", tab: "scheduling" },
  get_project_data: { label: "Overview", slug: "overview", tab: "summary" },
  get_estimate_summary: { label: "Estimate", slug: "estimate", tab: "estimates" },
  get_invoices: { label: "Invoices", slug: "financials", tab: "open" },
  get_lien_waivers: { label: "Lien waivers", slug: "financials", tab: "lien-waivers" },
  get_punch_list: { label: "Punch list", slug: "closeout", tab: "punchlist" },
  get_daily_logs: { label: "Daily log", slug: "field", tab: "daily-log" },
  get_weekly_logs: { label: "Weekly log", slug: "field", tab: "weekly-log" },
  get_todos: { label: "To-do", slug: "field", tab: "todo" },
  get_staff: { label: "Staff", slug: "field", tab: "staff" },
  get_procurement: { label: "Procurement", slug: "procurement", tab: "procurement" },
  get_contacts: { label: "Subcontractors", slug: "procurement", tab: "subs" },
  get_takeoff_items: { label: "Takeoff", slug: "takeoff", tab: "takeoff" },
  get_project_links: { label: "Project links", slug: "overview", tab: "summary" },
  get_sheet_pins: { label: "Sheet pins", slug: "takeoff", tab: "takeoff" },
  get_budget_summary: { label: "Budget", slug: "estimate", tab: "budget" },
  get_pay_applications: { label: "Pay applications", slug: "financials", tab: "pay-apps" },
  get_lookahead: { label: "Lookahead", slug: "schedule", tab: "scheduling" },
  get_production_quantities: { label: "Production", slug: "field", tab: "daily-log" },
  list_workspace_sections: { label: "Project sections", slug: "overview", tab: "summary" },
} as const;

export type ProjectSkillName = keyof typeof SKILL_TARGETS;

export interface SkillLink {
  skill: string;
  label: string;
  href: string;
}

function openPath(projectId: string, skill: ProjectSkillName): string {
  const target = SKILL_TARGETS[skill];
  return projectSectionHref(projectId, target.slug, target.tab);
}

export function skillLink(projectId: string, skill: string): SkillLink | null {
  if (!(skill in SKILL_TARGETS)) return null;
  const name = skill as ProjectSkillName;
  return { skill, label: SKILL_TARGETS[name].label, href: openPath(projectId, name) };
}

export function skillSectionGuide(projectId: string): string {
  const lines = PROJECT_SECTIONS.map((section) => {
    const tabs = section.tabs.map((tab) => `${tab.label} (${projectSectionHref(projectId, section.slug, tab.id)})`).join("; ");
    return `- ${section.id}: ${tabs}`;
  });
  return [
    "Workspace sections the user can open. When you direct them to do something, include the matching link.",
    "You can read these records with tools. You cannot create, edit, approve, award, or delete records — tell the user which screen to use.",
    ...lines,
  ].join("\n");
}

function clip(value: unknown, max = 280): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function redact<T extends Record<string, unknown>>(row: T, allowed: boolean, fields: readonly string[]): T {
  if (allowed) return row;
  const next = { ...row };
  for (const field of fields) {
    if (field in next) (next as Record<string, unknown>)[field] = null;
  }
  return next;
}

function empty(note: string, href: string) {
  return { count: 0, rows: [], open_in_app: href, note };
}

function packed(rows: unknown[], href: string, extra?: Record<string, unknown>) {
  return { count: rows.length, rows, open_in_app: href, ...extra };
}

const ESTIMATE_ROLLUP_PAGE = 1000;
const ESTIMATE_ROLLUP_MAX_ROWS = 50_000;

async function rollupEstimateTotals(
  db: Db,
  ctx: SkillContext,
  versionIds: string[],
): Promise<Map<string, { total_price: number; item_count: number }>> {
  const totals = new Map<string, { total_price: number; item_count: number }>();
  let seen = 0;
  for (let offset = 0; ; offset += ESTIMATE_ROLLUP_PAGE) {
    const { data, error } = await db
      .from("estimate_items")
      .select("estimate_version_id, total_price")
      .eq("tenant_id", ctx.tenantId)
      .eq("project_id", ctx.projectId)
      .in("estimate_version_id", versionIds)
      .order("id", { ascending: true })
      .range(offset, offset + ESTIMATE_ROLLUP_PAGE - 1);
    if (error) {
      throw new Error(typeof error.message === "string" && error.message ? error.message : "Could not read estimate items.");
    }
    const page = (data ?? []) as Array<{ estimate_version_id?: unknown; total_price?: unknown }>;
    for (const item of page) {
      const versionId = String(item.estimate_version_id ?? "");
      const current = totals.get(versionId) ?? { total_price: 0, item_count: 0 };
      current.total_price += Number(item.total_price ?? 0);
      current.item_count += 1;
      totals.set(versionId, current);
    }
    seen += page.length;
    if (page.length < ESTIMATE_ROLLUP_PAGE) return totals;
    if (seen >= ESTIMATE_ROLLUP_MAX_ROWS) {
      throw new Error("Estimate is too large to total completely.");
    }
  }
}

const CSI_NAMES: Record<string, string> = {
  "01": "general requirements",
  "02": "existing conditions site demolition",
  "03": "concrete cast-in-place reinforced",
  "04": "masonry brick block",
  "05": "metals structural steel framing",
  "06": "wood plastics composites rough carpentry",
  "07": "thermal moisture protection waterproofing roofing insulation",
  "08": "openings doors windows glazing",
  "09": "finishes flooring ceiling drywall paint",
  "10": "specialties",
  "11": "equipment",
  "12": "furnishings",
  "13": "special construction",
  "14": "conveying equipment elevators",
  "21": "fire suppression sprinkler",
  "22": "plumbing piping fixtures",
  "23": "HVAC heating ventilation air conditioning mechanical",
  "26": "electrical power lighting",
  "27": "communications low voltage",
  "28": "electronic safety security fire alarm",
  "31": "earthwork grading excavation",
  "32": "exterior improvements paving site concrete",
  "33": "utilities underground",
};

export const PROJECT_SKILL_DECLARATIONS = [
  {
    name: "search_project_docs",
    description:
      "Semantically search indexed project documents (drawings, specs, submittals, contracts). " +
      "Use when the question involves document content, specifications, materials, quantities, or referenced sheets.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Natural language search query" } },
      required: ["query"],
    },
  },
  {
    name: "get_related_specs",
    description:
      "Broad cross-reference sweep of indexed spec sections for a CSI division, trade, or topic. Returns up to 15 excerpts.",
    parameters: {
      type: "OBJECT",
      properties: {
        division: { type: "STRING", description: "CSI division number, trade name, or topic" },
        max_results: { type: "NUMBER", description: "How many spec excerpts to return. Default 10, max 15." },
      },
      required: ["division"],
    },
  },
  {
    name: "get_documents",
    description:
      "List project files and their processing pipeline: split, OCR, vector, takeoff, plus the last error if a stage failed.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_open_rfis",
    description:
      "List Requests for Information. Status values: draft, open, answered, closed, void, or all.",
    parameters: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", description: "draft | open | answered | closed | void | all. Default open." },
      },
      required: [],
    },
  },
  {
    name: "get_submittals",
    description:
      "List submittals. Status values: draft, submitted, under_review, approved, approved_as_noted, revise_resubmit, rejected, closed, void, or all.",
    parameters: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", description: "A submittal status or all. Default all." },
      },
      required: [],
    },
  },
  {
    name: "get_change_orders",
    description:
      "List change orders. Status values: draft, pending, approved, rejected, void, or all. Amounts are omitted when the user cannot view financials.",
    parameters: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", description: "draft | pending | approved | rejected | void | all. Default all." },
      },
      required: [],
    },
  },
  {
    name: "get_schedule_tasks",
    description: "List schedule tasks with dates, status, and float. Filter: incomplete, overdue, upcoming_30d, or all.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: { type: "STRING", description: "incomplete | overdue | upcoming_30d | all. Default all." },
      },
      required: [],
    },
  },
  {
    name: "get_project_data",
    description: "Core project facts: name, status, location, dates, budget, and stored estimate/completion when present.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_estimate_summary",
    description: "Estimate headers and, when allowed, current-version price totals. Does not change the estimate.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_invoices",
    description: "Invoices. direction: receivable, payable, or all. status: open, paid, overdue, disputed, canceled, or all.",
    parameters: {
      type: "OBJECT",
      properties: {
        direction: { type: "STRING", description: "receivable | payable | all. Default all." },
        status: { type: "STRING", description: "open | paid | overdue | disputed | canceled | all. Default all." },
      },
      required: [],
    },
  },
  {
    name: "get_lien_waivers",
    description: "Lien waivers and their status (pending, received, expired).",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_punch_list",
    description: "Punch list items. Filter open (not complete) or all.",
    parameters: {
      type: "OBJECT",
      properties: { filter: { type: "STRING", description: "open | all. Default open." } },
      required: [],
    },
  },
  {
    name: "get_daily_logs",
    description: "Recent daily logs: date, weather, crew, and work performed.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_weekly_logs",
    description: "Recent weekly status logs: schedule, budget note, open issues, and summary.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_todos",
    description: "Project to-do items. Filter open (not done) or all.",
    parameters: {
      type: "OBJECT",
      properties: { filter: { type: "STRING", description: "open | all. Default open." } },
      required: [],
    },
  },
  {
    name: "get_staff",
    description: "People assigned to the project and their roles. Pay rates are never returned.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_procurement",
    description: "Material requests (RFQs) and purchase orders for this project.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_contacts",
    description: "Contacts linked to this project: name, company, role, email, phone.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_takeoff_items",
    description:
      "Takeoff quantities and review status. review_status: suggested, reviewed, approved, rejected, or all. Prices are not returned.",
    parameters: {
      type: "OBJECT",
      properties: {
        review_status: { type: "STRING", description: "suggested | reviewed | approved | rejected | all. Default all." },
      },
      required: [],
    },
  },
  {
    name: "get_project_links",
    description: "List links between records in this project: RFIs, schedule tasks, budget lines, purchase orders, and the rest.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_sheet_pins",
    description: "List pins dropped on this project's sheets and the record each pin opens.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_budget_summary",
    description: "Read this project's current budget snapshot. Amounts are omitted when the user cannot view financials.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_pay_applications",
    description: "List pay applications on this project. Amounts are omitted when the user cannot view financials.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_lookahead",
    description: "List schedule tasks whose dates fall in the next 21 days on this project.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "get_production_quantities",
    description: "List quantities installed on this project from daily logs.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
  {
    name: "list_workspace_sections",
    description: "List every project section and the exact link to open it. Use when the user asks where to do something.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
];

async function searchChunks(
  db: Db,
  ctx: SkillContext,
  queryText: string,
  matchCount: number,
): Promise<ChunkRow[]> {
  if (!ctx.embedText) return [];
  const embedding = await ctx.embedText(queryText);
  const vectorStr = `[${embedding.join(",")}]`;
  const { data } = await db.rpc("match_chunks", {
    query_embedding: vectorStr,
    match_tenant_id: ctx.tenantId,
    match_project_id: ctx.projectId,
    query_text: queryText,
    match_count: matchCount,
  }) as { data: ChunkRow[] | null };
  return data ?? [];
}

export async function executeProjectSkill(
  name: string,
  args: Record<string, unknown>,
  db: Db,
  ctx: SkillContext,
): Promise<unknown> {
  const href = skillLink(ctx.projectId, name)?.href
    ?? projectSectionHref(ctx.projectId, "overview", "summary");

  switch (name) {
    case "list_workspace_sections": {
      return {
        open_in_app: href,
        sections: PROJECT_SECTIONS.map((section) => ({
          section: section.id,
          tabs: section.tabs.map((tab) => ({
            label: tab.label,
            href: projectSectionHref(ctx.projectId, section.slug, tab.id),
          })),
        })),
      };
    }
    case "search_project_docs": {
      const query = String(args.query ?? "").trim();
      if (!query) return "No query provided.";
      try {
        const chunks = (await searchChunks(db, ctx, query, 6)).filter((chunk) => chunk.rrf_score > 0.01);
        if (chunks.length === 0) return `No relevant document excerpts found.\n\nOpen in app: ${href}`;
        for (const chunk of chunks) {
          ctx.citationsOut.push({
            document_id: chunk.document_id,
            page_number: chunk.page_number,
            similarity: chunk.similarity,
          });
        }
        return `${chunks.map((chunk, index) => `[${index + 1}] (page:${chunk.page_number})\n${chunk.content}`).join("\n\n")}\n\nOpen in app: ${href}`;
      } catch {
        return "Document search failed.";
      }
    }
    case "get_related_specs": {
      const division = String(args.division ?? "").trim();
      if (!division) return "No division or topic provided.";
      const maxResults = Math.min(Math.max(1, Number(args.max_results ?? 10)), 15);
      const numMatch = division.match(/\b(\d{1,2})\b/);
      const divNum = numMatch ? numMatch[1].padStart(2, "0") : null;
      const csiFull = divNum ? CSI_NAMES[divNum] : null;
      const searchQuery = csiFull
        ? `Division ${divNum} ${csiFull} specifications requirements`
        : `${division} specifications requirements`;
      try {
        const chunks = await searchChunks(db, ctx, searchQuery, maxResults);
        if (chunks.length === 0) {
          return `No indexed spec sections found for "${division}". Upload and index spec documents first.\n\nOpen in app: ${href}`;
        }
        for (const chunk of chunks) {
          ctx.citationsOut.push({
            document_id: chunk.document_id,
            page_number: chunk.page_number,
            similarity: chunk.similarity,
          });
        }
        const label = csiFull ? `Division ${divNum} — ${csiFull}` : division;
        return `Cross-reference: ${label}\n\n${chunks.map((chunk, index) => `[${index + 1}] page ${chunk.page_number}\n${chunk.content}`).join("\n\n---\n\n")}\n\nOpen in app: ${href}`;
      } catch {
        return "Spec cross-reference search failed.";
      }
    }
    case "get_documents": {
      const { data, error } = await db
        .from("documents")
        .select("id, file_name, status, page_count, split_status, ocr_status, vector_status, takeoff_status, last_error, last_error_step, uploaded_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("uploaded_at", { ascending: false })
        .limit(25);
      if (error) return { error: clip(error.message) ?? "Could not read documents.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        last_error: clip(row.last_error, 180),
      }));
      return rows.length ? packed(rows, href) : empty("No documents uploaded on this project.", href);
    }
    case "get_open_rfis": {
      const status = String(args.status ?? "open");
      let query = db
        .from("rfi_items")
        .select("id, number, subject, status, priority, discipline, description, assigned_to, due_date, response")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read RFIs.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        description: clip(row.description),
        response: clip(row.response),
      }));
      return rows.length ? packed(rows, href) : empty(`No RFIs with status "${status}".`, href);
    }
    case "get_submittals": {
      const status = String(args.status ?? "all");
      let query = db
        .from("submittal_items")
        .select("id, number, title, status, submittal_type, spec_section, revision, responsible, due_date, description")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read submittals.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({ ...row, description: clip(row.description) }));
      return rows.length ? packed(rows, href) : empty("No submittals found.", href);
    }
    case "get_change_orders": {
      const status = String(args.status ?? "all");
      let query = db
        .from("change_order_items")
        .select("id, number, description, status, trade, reason, amount, labor_cost, material_cost, equipment_cost, subcontract_cost, markup")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read change orders.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) =>
        redact(
          { ...row, description: clip(row.description) },
          ctx.canReadFinancial,
          CHANGE_ORDER_FINANCIAL_FIELDS,
        ),
      );
      return rows.length
        ? packed(rows, href, { financials_redacted: !ctx.canReadFinancial })
        : empty("No change orders found.", href);
    }
    case "get_schedule_tasks": {
      const filter = String(args.filter ?? "all");
      let query = db
        .from("schedule_tasks")
        .select("id, name, status, start_date, end_date, duration, critical, total_float")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("start_date", { ascending: true })
        .limit(40);
      const today = new Date().toISOString().split("T")[0];
      if (filter === "incomplete") query = query.neq("status", "complete");
      else if (filter === "overdue") query = query.lt("end_date", today).neq("status", "complete");
      else if (filter === "upcoming_30d") {
        const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
        query = query.gte("start_date", today).lte("start_date", thirtyDays);
      }
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read the schedule.", open_in_app: href };
      const rows = data ?? [];
      return rows.length ? packed(rows, href) : empty("No schedule tasks found.", href);
    }
    case "get_project_data": {
      const { data, error } = await db
        .from("projects")
        .select("id, name, status, budget, start_date, end_date, address, city, state, zip_code, meta")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", ctx.projectId)
        .single();
      if (error || !data) return { error: "Project not found.", open_in_app: href };
      const meta = (data.meta ?? {}) as Record<string, unknown>;
      const estimate = typeof meta.estimate === "number" ? meta.estimate : null;
      const completionPct = typeof meta.completion_pct === "number" ? meta.completion_pct : null;
      return {
        id: data.id,
        name: data.name,
        status: data.status,
        location: [data.address, data.city, data.state, data.zip_code].filter(Boolean).join(", ") || null,
        start_date: data.start_date,
        end_date: data.end_date,
        budget: ctx.canReadFinancial ? data.budget : null,
        estimate: ctx.canReadFinancial ? estimate : null,
        completion_pct: completionPct,
        financials_redacted: !ctx.canReadFinancial,
        open_in_app: href,
      };
    }
    case "get_estimate_summary": {
      const { data, error } = await db
        .from("estimates")
        .select("id, name, estimate_number, status, estimate_type, current_version_id")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) return { error: clip(error.message) ?? "Could not read estimates.", open_in_app: href };
      const estimates = (data ?? []) as Array<Record<string, unknown>>;
      if (estimates.length === 0) return empty("No estimates on this project.", href);
      const versionIds = estimates.map((row) => row.current_version_id).filter((id): id is string => typeof id === "string");
      let totals = new Map<string, { total_price: number; item_count: number }>();
      if (versionIds.length > 0 && ctx.canReadFinancial) {
        try {
          totals = await rollupEstimateTotals(db, ctx, versionIds);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: clip(message) ?? "Could not total the estimate.", open_in_app: href };
        }
      }
      const rows = estimates.map((row) => {
        const versionId = typeof row.current_version_id === "string" ? row.current_version_id : "";
        const rollup = totals.get(versionId);
        return {
          ...row,
          current_total: ctx.canReadFinancial ? rollup?.total_price ?? null : null,
          item_count: rollup?.item_count ?? null,
        };
      });
      return packed(rows, href, { financials_redacted: !ctx.canReadFinancial });
    }
    case "get_invoices": {
      const direction = String(args.direction ?? "all");
      const status = String(args.status ?? "all");
      let query = db
        .from("invoices")
        .select("id, direction, invoice_number, vendor_or_customer, description, amount, retainage, status, invoice_date, due_date, paid_date")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("invoice_date", { ascending: false })
        .limit(30);
      if (direction !== "all") query = query.eq("direction", direction);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read invoices.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) =>
        redact({ ...row, description: clip(row.description) }, ctx.canReadFinancial, INVOICE_FINANCIAL_FIELDS),
      );
      return rows.length
        ? packed(rows, href, { financials_redacted: !ctx.canReadFinancial })
        : empty("No invoices found.", href);
    }
    case "get_lien_waivers": {
      const { data, error } = await db
        .from("lien_waivers")
        .select("id, vendor_name, waiver_type, status, amount, through_date, signed_at, signed_by")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) return { error: clip(error.message) ?? "Could not read lien waivers.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) =>
        redact(row, ctx.canReadFinancial, ["amount"]),
      );
      return rows.length
        ? packed(rows, href, { financials_redacted: !ctx.canReadFinancial })
        : empty("No lien waivers found.", href);
    }
    case "get_punch_list": {
      const filter = String(args.filter ?? "open");
      let query = db
        .from("punch_list_items")
        .select("id, item_number, description, status, priority, location, trade, responsible, due_date")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (filter === "open") query = query.neq("status", "complete");
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read the punch list.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({ ...row, description: clip(row.description) }));
      return rows.length ? packed(rows, href) : empty("No punch items found.", href);
    }
    case "get_daily_logs": {
      const { data, error } = await db
        .from("daily_logs")
        .select("id, log_date, weather, temperature, crew_count, work_performed, notes")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("log_date", { ascending: false })
        .limit(14);
      if (error) return { error: clip(error.message) ?? "Could not read daily logs.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        work_performed: clip(row.work_performed),
        notes: clip(row.notes),
      }));
      return rows.length ? packed(rows, href) : empty("No daily logs yet.", href);
    }
    case "get_weekly_logs": {
      const { data, error } = await db
        .from("weekly_logs")
        .select("id, week_start, week_end, schedule_status, budget_status, open_issues, decisions_needed, summary")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("week_start", { ascending: false })
        .limit(8);
      if (error) return { error: clip(error.message) ?? "Could not read weekly logs.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        schedule_status: clip(row.schedule_status),
        budget_status: ctx.canReadFinancial ? clip(row.budget_status) : null,
        open_issues: clip(row.open_issues),
        decisions_needed: clip(row.decisions_needed),
        summary: clip(row.summary, 500),
      }));
      return rows.length
        ? packed(rows, href, { financials_redacted: !ctx.canReadFinancial })
        : empty("No weekly logs yet.", href);
    }
    case "get_todos": {
      const filter = String(args.filter ?? "open");
      let query = db
        .from("todo_items")
        .select("id, title, status, priority, assignee, due_date, notes")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("due_date", { ascending: true })
        .limit(30);
      if (filter === "open") query = query.neq("status", "done");
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read to-dos.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => ({ ...row, notes: clip(row.notes) }));
      return rows.length ? packed(rows, href) : empty("No to-do items found.", href);
    }
    case "get_staff": {
      const { data, error } = await db
        .from("staff_members")
        .select("id, name, role, project_role, email, phone, removed_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("name", { ascending: true })
        .limit(40);
      if (error) return { error: clip(error.message) ?? "Could not read staff.", open_in_app: href };
      const rows = (data ?? []).filter((row: { removed_at?: string | null }) => !row.removed_at);
      return rows.length ? packed(rows, href) : empty("No active staff assigned.", href);
    }
    case "get_procurement": {
      const requestsResult = await db
        .from("marketplace_requests")
        .select("id, batch_label, item_description, quantity, unit, status, required_date")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(25);
      const poResult = await db
        .from("purchase_orders")
        .select("id, po_number, status, total_amount, terms")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(15);
      if (requestsResult.error && poResult.error) {
        return { error: "Could not read procurement.", open_in_app: href };
      }
      const requests = (requestsResult.data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        item_description: clip(row.item_description),
      }));
      const purchaseOrders = (poResult.data ?? []).map((row: Record<string, unknown>) =>
        redact(row, ctx.canReadFinancial, ["total_amount"]),
      );
      if (requests.length === 0 && purchaseOrders.length === 0) return empty("No procurement requests or purchase orders.", href);
      return {
        request_count: requests.length,
        requests,
        purchase_order_count: purchaseOrders.length,
        purchase_orders: purchaseOrders,
        financials_redacted: !ctx.canReadFinancial,
        open_in_app: href,
      };
    }
    case "get_contacts": {
      const linked = await db
        .from("project_contacts")
        .select("contact_id, role_on_project, is_primary")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .limit(40);
      if (!linked.error && (linked.data ?? []).length > 0) {
        const ids = (linked.data as Array<{ contact_id: string }>).map((row) => row.contact_id);
        const { data, error } = await db
          .from("contacts")
          .select("id, name, company, role, email, phone")
          .in("id", ids);
        if (error) return { error: clip(error.message) ?? "Could not read contacts.", open_in_app: href };
        const roles = new Map((linked.data as Array<{ contact_id: string; role_on_project: string | null }>).map((row) => [row.contact_id, row.role_on_project]));
        const rows = (data ?? []).map((row: { id: string }) => ({ ...row, role_on_project: roles.get(row.id) ?? null }));
        return rows.length ? packed(rows, href) : empty("No contacts linked to this project.", href);
      }
      const { data, error } = await db
        .from("contacts")
        .select("id, name, company, role, email, phone")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("name", { ascending: true })
        .limit(40);
      if (error) return { error: clip(error.message) ?? "Could not read contacts.", open_in_app: href };
      const rows = data ?? [];
      return rows.length ? packed(rows, href) : empty("No contacts linked to this project.", href);
    }
    case "get_takeoff_items": {
      const reviewStatus = String(args.review_status ?? "all");
      let query = db
        .from("takeoff_items")
        .select("id, label, type, quantity, unit, review_status, page, division, csi_code")
        .eq("tenant_id", ctx.tenantId)
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (reviewStatus !== "all") query = query.eq("review_status", reviewStatus);
      const { data, error } = await query;
      if (error) return { error: clip(error.message) ?? "Could not read takeoff items.", open_in_app: href };
      const rows = data ?? [];
      return rows.length ? packed(rows, href) : empty("No takeoff items found.", href);
    }
    case "get_project_links": {
      const { data, error } = await db.from("project_record_links").select("id, from_type, from_id, to_type, to_id, link_role").eq("tenant_id", ctx.tenantId).eq("project_id", ctx.projectId).limit(40);
      if (error) return { error: clip(error.message) ?? "Could not read links.", open_in_app: href };
      const rows = data ?? [];
      return rows.length ? packed(rows, href) : empty("No linked records in this project.", href);
    }
    case "get_sheet_pins": {
      const { data, error } = await db.from("sheet_pins").select("id, page_id, entity_type, entity_id, label, x, y").eq("tenant_id", ctx.tenantId).eq("project_id", ctx.projectId).limit(40);
      if (error) return { error: clip(error.message) ?? "Could not read sheet pins.", open_in_app: href };
      const rows = data ?? [];
      return rows.length ? packed(rows, href) : empty("No sheet pins in this project.", href);
    }
    case "get_budget_summary": {
      const { data, error } = await db.from("project_budgets").select("id, total_price, line_count, is_current, version_number").eq("tenant_id", ctx.tenantId).eq("project_id", ctx.projectId).eq("is_current", true).limit(1);
      if (error) return { error: clip(error.message) ?? "Could not read the budget.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => redact(row, ctx.canReadFinancial, ["total_price"]));
      return rows.length ? packed(rows, href, { financials_redacted: !ctx.canReadFinancial }) : empty("No current budget snapshot on this project.", href);
    }
    case "get_pay_applications": {
      const { data, error } = await db.from("pay_applications").select("id, number, side, status, draw_number, retainage_pct").eq("tenant_id", ctx.tenantId).eq("project_id", ctx.projectId).limit(20);
      if (error) return { error: clip(error.message) ?? "Could not read pay applications.", open_in_app: href };
      const rows = (data ?? []).map((row: Record<string, unknown>) => redact(row, ctx.canReadFinancial, ["retainage_pct"]));
      return rows.length ? packed(rows, href, { financials_redacted: !ctx.canReadFinancial }) : empty("No pay applications on this project.", href);
    }
    case "get_lookahead": {
      const { data, error } = await db.from("schedule_tasks").select("id, name, start_date, end_date, status, critical, percent_complete").eq("tenant_id", ctx.tenantId).eq("project_id", ctx.projectId).limit(40);
      if (error) return { error: clip(error.message) ?? "Could not read the schedule.", open_in_app: href };
      const now = Date.now();
      const horizon = now + 21 * 86400000;
      const rows = (data ?? []).filter((row: { start_date: string | null; end_date: string | null }) => {
        const start = row.start_date ? new Date(row.start_date).getTime() : null;
        const end = row.end_date ? new Date(row.end_date).getTime() : start;
        return start != null && end != null && start <= horizon && end >= now;
      });
      return rows.length ? packed(rows, href) : empty("No tasks in the next 21 days.", href);
    }
    case "get_production_quantities": {
      const { data, error } = await db.from("daily_log_quantities").select("id, daily_log_id, budget_line_id, quantity, unit").eq("tenant_id", ctx.tenantId).eq("project_id", ctx.projectId).limit(40);
      if (error) return { error: clip(error.message) ?? "Could not read production quantities.", open_in_app: href };
      const rows = data ?? [];
      return rows.length ? packed(rows, href) : empty("No installed quantities logged on this project.", href);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
