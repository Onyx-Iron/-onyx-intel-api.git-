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
    tabs: [
      { id: "estimates", label: "Estimate & Budget", keywords: "price proposal sov version" },
      { id: "budget", label: "Budget", keywords: "original revised committed forecast margin" },
      { id: "selections", label: "Selections", keywords: "allowance client selection" },
    ],
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
      { id: "pay-apps", label: "Pay Applications", keywords: "pay app sov draw retainage" },
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
      { id: "time", label: "Time Cards", keywords: "time card hours labor" },
      { id: "meetings", label: "Meetings", keywords: "meeting action item" },
    ],
  },
  {
    id: "Closeout",
    slug: "closeout",
    keywords: "punch certificate occupancy final",
    tabs: [
      { id: "punchlist", label: "Punchlist", keywords: "punch deficiency closeout" },
      { id: "co", label: "Certificate of Occupancy", keywords: "co occupancy certificate" },
      { id: "inspections", label: "Closeout Assembly", keywords: "inspection warranty manual punch walk" },
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

/** One-line helper shown under the active project section. */
export const PHASE_HELPER: Record<string, string> = {
  overview: "Project health, location, and recent activity.",
  documents: "Upload PDFs here. Split pages feed Takeoff and search.",
  takeoff: "Measure sheets and extract quantities from uploaded plans.",
  estimate: "Price takeoff lines and build the bid.",
  schedule: "Tasks and dates for this job.",
  controls: "RFIs, submittals, and change orders.",
  procurement: "RFQs, vendor bids, and purchase orders.",
  financials: "Invoices and lien waivers for this job.",
  field: "Daily logs, crew, and site to-dos.",
  closeout: "Punch list and final documents.",
};

/** Empty company roll-up: jump into a project, or create one. */
export function chooseOrCreateProjectHref(
  projectId: string | null | undefined,
  slug: string,
  tab: string,
): string {
  if (projectId) return projectSectionHref(projectId, slug, tab);
  return "/dashboard/projects?new=1";
}
