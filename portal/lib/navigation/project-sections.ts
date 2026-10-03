/** Canonical project-workspace sections. URLs use `?phase=&tab=`. */

export const PROJECT_SECTIONS = [
  {
    id: "Overview",
    slug: "overview",
    keywords: "home summary dashboard",
    tabs: [
      { id: "summary", label: "Summary", keywords: "overview status" },
      { id: "risk", label: "Risk Assessment", keywords: "risk digest ai scout" },
    ],
  },
  {
    id: "Documents",
    slug: "documents",
    keywords: "plans specs drawings files upload",
    tabs: [{ id: "documents", label: "Documents", keywords: "upload plans specs pipeline ocr" }],
  },
  {
    id: "Takeoff",
    slug: "takeoff",
    keywords: "quantities measure canvas drawings",
    tabs: [
      { id: "takeoff", label: "Takeoff", keywords: "measure quantities canvas extract" },
      { id: "cutfill", label: "Cut / Fill", keywords: "earthwork civil volume mass haul" },
    ],
  },
  {
    id: "Estimate & Budget",
    slug: "estimate",
    keywords: "pricing proposal budget bid",
    tabs: [{ id: "estimates", label: "Estimate & Budget", keywords: "price proposal sov version" }],
  },
  {
    id: "Schedule",
    slug: "schedule",
    keywords: "gantt timeline tasks milestones",
    tabs: [{ id: "scheduling", label: "Schedule", keywords: "gantt tasks dates critical" }],
  },
  {
    id: "Project Controls",
    slug: "controls",
    keywords: "rfi submittal change order",
    tabs: [
      {
        id: "controls",
        label: "RFIs, Submittals & Change Orders",
        keywords: "rfi submittal change order co asi",
      },
    ],
  },
  {
    id: "Procurement",
    slug: "procurement",
    keywords: "rfq vendor bid purchase order materials",
    tabs: [
      { id: "procurement", label: "Vendor Bids & POs", keywords: "rfq bid award purchase order po" },
      { id: "materials", label: "Material Vendors", keywords: "materials suppliers pricing" },
      { id: "equipment", label: "Equipment Suppliers", keywords: "equipment rental suppliers" },
      { id: "subs", label: "Subcontractors", keywords: "contacts subs companies" },
    ],
  },
  {
    id: "Financials",
    slug: "financials",
    keywords: "invoice billing money ar ap",
    tabs: [
      { id: "ar", label: "Accounts Receivable", keywords: "ar billing customer invoices" },
      { id: "ap", label: "Accounts Payable", keywords: "ap vendor bills" },
      { id: "open", label: "Open Invoices", keywords: "unpaid invoices" },
      { id: "closed", label: "Closed Invoices", keywords: "paid invoices" },
      { id: "lien-waivers", label: "Lien Waivers", keywords: "waiver lien release" },
    ],
  },
  {
    id: "Field",
    slug: "field",
    keywords: "daily log weekly crew site",
    tabs: [
      { id: "daily-log", label: "Daily Log", keywords: "daily report weather crew" },
      { id: "weekly-log", label: "Weekly Log", keywords: "weekly status report" },
      { id: "todo", label: "To Do List", keywords: "tasks action items" },
      { id: "staff", label: "Staff", keywords: "crew people assignments" },
    ],
  },
  {
    id: "Closeout",
    slug: "closeout",
    keywords: "punch certificate occupancy final",
    tabs: [
      { id: "punchlist", label: "Punchlist", keywords: "punch deficiency closeout" },
      { id: "co", label: "Certificate of Occupancy", keywords: "co occupancy certificate" },
      { id: "final-docs", label: "Final Docs", keywords: "closeout documents as-built" },
    ],
  },
] as const;

export type ProjectPhase = (typeof PROJECT_SECTIONS)[number]["id"];
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export function phaseFromSlug(slug: string | null | undefined): ProjectPhase | null {
  if (!slug) return null;
  const match = PROJECT_SECTIONS.find((section) => section.slug === slug);
  return match?.id ?? null;
}

export function projectSectionHref(projectId: string, slug: string, tab: string): string {
  const params = new URLSearchParams({ phase: slug, tab });
  return `/dashboard/projects/${projectId}?${params.toString()}`;
}
