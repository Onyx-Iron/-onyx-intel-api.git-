import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { executeProjectSkill, skillLink, type SkillContext } from "./project-skills.ts";
import { filterDestinations, projectDestinations, WORKSPACE_DESTINATIONS } from "../navigation/destinations.ts";
import { PROJECT_SECTIONS } from "../navigation/project-sections.ts";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const selects: { table: string; columns: string }[] = [];
  function from(table: string) {
    const state = {
      filters: [] as Array<{ op: string; col: string; val: unknown }>,
      columns: [] as string[],
    };
    const chain: Record<string, unknown> = {};
    const run = () =>
      (tables[table] ?? [])
        .filter((row) =>
          state.filters.every((filter) => {
            if (filter.op === "eq") return row[filter.col] === filter.val;
            if (filter.op === "neq") return row[filter.col] !== filter.val;
            if (filter.op === "in") return Array.isArray(filter.val) && filter.val.includes(row[filter.col]);
            return true;
          }),
        )
        .map((row) => {
          if (state.columns.length === 0) return row;
          const projected: Row = {};
          for (const column of state.columns) projected[column] = row[column];
          return projected;
        });
    const passthrough = () => chain;
    chain.select = (columns: string) => {
      state.columns = columns.split(",").map((column) => column.trim());
      selects.push({ table, columns });
      return chain;
    };
    chain.eq = (col: string, val: unknown) => {
      state.filters.push({ op: "eq", col, val });
      return chain;
    };
    chain.neq = (col: string, val: unknown) => {
      state.filters.push({ op: "neq", col, val });
      return chain;
    };
    chain.in = (col: string, val: unknown[]) => {
      state.filters.push({ op: "in", col, val });
      return chain;
    };
    chain.lt = passthrough;
    chain.gte = passthrough;
    chain.lte = passthrough;
    chain.order = passthrough;
    chain.limit = passthrough;
    chain.single = () => Promise.resolve({ data: run()[0] ?? null, error: null });
    chain.then = (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: run(), error: null }).then(resolve, reject);
    return chain;
  }
  return { from, selects, rpc: async () => ({ data: [] }) };
}

function ctx(partial?: Partial<SkillContext>): SkillContext {
  return {
    tenantId: "tenant-1",
    projectId: "project-1",
    canReadFinancial: false,
    citationsOut: [],
    ...partial,
  };
}

describe("project skills", () => {
  it("reads RFI subject and assignee columns and defaults to open", async () => {
    const db = fakeDb({
      rfi_items: [
        { id: "1", tenant_id: "tenant-1", project_id: "project-1", number: "RFI-1", subject: "Slab edge", status: "open", assigned_to: "Arch", description: "Confirm", response: null, priority: "high", discipline: "Civil", due_date: null },
        { id: "2", tenant_id: "tenant-1", project_id: "project-1", number: "RFI-2", subject: "Closed one", status: "closed", assigned_to: "Eng", description: null, response: null, priority: "low", discipline: null, due_date: null },
      ],
    });

    const result = await executeProjectSkill("get_open_rfis", {}, db, ctx()) as { count: number; rows: Array<{ subject: string }> };

    assert.equal(result.count, 1);
    assert.equal(result.rows[0].subject, "Slab edge");
    const select = db.selects.find((entry) => entry.table === "rfi_items");
    assert.ok(select);
    assert.match(select.columns, /subject/);
    assert.match(select.columns, /assigned_to/);
    assert.doesNotMatch(select.columns, /\btitle\b/);
  });

  it("reads schedule task names", async () => {
    const db = fakeDb({
      schedule_tasks: [
        { id: "t1", tenant_id: "tenant-1", project_id: "project-1", name: "Pour slab", status: "open", start_date: "2026-10-01", end_date: "2026-10-03", duration: 2, critical: true, total_float: 0 },
      ],
    });
    const result = await executeProjectSkill("get_schedule_tasks", { filter: "all" }, db, ctx()) as { rows: Array<{ name: string }> };
    assert.equal(result.rows[0].name, "Pour slab");
    assert.match(db.selects[0].columns, /\bname\b/);
    assert.doesNotMatch(db.selects[0].columns, /\btitle\b/);
  });

  it("hides invoice amounts unless the caller can read financials", async () => {
    const invoices = [
      { id: "inv", tenant_id: "tenant-1", project_id: "project-1", direction: "payable", invoice_number: "100", vendor_or_customer: "Acme", description: "Concrete", amount: 1200, retainage: 100, status: "open", invoice_date: "2026-10-01", due_date: null, paid_date: null },
    ];
    const hidden = await executeProjectSkill("get_invoices", {}, fakeDb({ invoices }), ctx()) as { rows: Array<{ amount: number | null }>; financials_redacted: boolean };
    assert.equal(hidden.rows[0].amount, null);
    assert.equal(hidden.financials_redacted, true);

    const shown = await executeProjectSkill("get_invoices", {}, fakeDb({ invoices }), ctx({ canReadFinancial: true })) as { rows: Array<{ amount: number }> };
    assert.equal(shown.rows[0].amount, 1200);
  });

  it("omits pay rates and removed staff", async () => {
    const db = fakeDb({
      staff_members: [
        { id: "a", tenant_id: "tenant-1", project_id: "project-1", name: "Ada", role: "PM", project_role: null, email: null, phone: null, removed_at: null, hourly_rate: 90 },
        { id: "b", tenant_id: "tenant-1", project_id: "project-1", name: "Gone", role: "Labor", project_role: null, email: null, phone: null, removed_at: "2026-01-01" },
      ],
    });
    const result = await executeProjectSkill("get_staff", {}, db, ctx()) as { rows: Array<Record<string, unknown>> };
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, "Ada");
    assert.equal("hourly_rate" in result.rows[0], false);
    assert.doesNotMatch(db.selects[0].columns, /hourly_rate/);
  });

  it("points every skill at a real project section", () => {
    for (const section of PROJECT_SECTIONS) {
      const link = skillLink("job-9", "list_workspace_sections");
      assert.ok(link);
      assert.match(link.href, /phase=overview/);
      assert.match(projectDestinations("job-9", "Job 9").map((item) => item.href).join("\n"), new RegExp(`phase=${section.slug}`));
    }
    assert.equal(skillLink("job-9", "not-a-skill"), null);
  });

  it("rejects unknown tools", async () => {
    const result = await executeProjectSkill("delete_project", {}, fakeDb({}), ctx()) as { error: string };
    assert.match(result.error, /Unknown tool/);
  });
});

describe("destination search", () => {
  it("finds project functions and company workspaces from plain language", () => {
    const project = projectDestinations("job-9", "River Park");
    const all = [...project, ...WORKSPACE_DESTINATIONS];

    const liens = filterDestinations(all, "lien waiver");
    assert.equal(liens[0]?.label, "Lien Waivers");
    assert.match(liens[0].href, /phase=financials&tab=lien-waivers/);

    const rfis = filterDestinations(all, "rfi river");
    assert.equal(rfis[0]?.label, "RFIs, Submittals & Change Orders");

    const priceBook = filterDestinations(all, "price book");
    assert.equal(priceBook[0]?.href, "/dashboard/price-book");
  });

  it("keeps project section ids aligned with the workspace tabs", () => {
    const source = readFileSync(new URL("../../app/dashboard/projects/[id]/ProjectTabs.tsx", import.meta.url), "utf8");
    for (const section of PROJECT_SECTIONS) {
      assert.match(source, new RegExp(`id: "${section.id}"`));
      for (const tab of section.tabs) {
        assert.match(source, new RegExp(`id: "${tab.id}"`));
      }
    }
  });
});
