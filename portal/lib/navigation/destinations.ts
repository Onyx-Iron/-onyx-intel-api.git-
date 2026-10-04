import { PROJECT_SECTIONS, projectSectionHref } from "@/lib/navigation/project-sections";

export type DestinationGroup = "Project" | "Workspace" | "Settings";

export interface Destination {
  id: string;
  label: string;
  hint: string;
  href: string;
  group: DestinationGroup;
  keywords: string;
}

export const WORKSPACE_DESTINATIONS: Destination[] = [
  { id: "home", label: "Home", hint: "Command center", href: "/dashboard", group: "Workspace", keywords: "dashboard overview ai" },
  { id: "projects", label: "Projects", hint: "Create and open jobs", href: "/dashboard/projects", group: "Workspace", keywords: "jobs new project" },
  { id: "bid-board", label: "Bid Board", hint: "Preconstruction opportunities", href: "/dashboard/preconstruction", group: "Workspace", keywords: "bids sam preconstruction opportunities" },
  { id: "reports", label: "Reports", hint: "Status summaries", href: "/dashboard/reports", group: "Workspace", keywords: "status report export" },
  { id: "ai", label: "AI Workforce", hint: "Approvals and agent runs", href: "/dashboard/agents/pending", group: "Workspace", keywords: "agents approval risk scout" },
  { id: "pm", label: "Project Management", hint: "Open items across jobs", href: "/dashboard/project-management", group: "Workspace", keywords: "rfi submittal punch schedule rollup" },
  { id: "takeoff", label: "Takeoff", hint: "Quantities across jobs", href: "/dashboard/takeoff", group: "Workspace", keywords: "measure plans" },
  { id: "estimating", label: "Estimating", hint: "Priced estimates across jobs", href: "/dashboard/estimating", group: "Workspace", keywords: "budget proposal" },
  { id: "documents", label: "Documents", hint: "Plan processing status", href: "/dashboard/documents", group: "Workspace", keywords: "files ocr pipeline upload" },
  { id: "contacts", label: "Contacts", hint: "People and companies", href: "/dashboard/contacts", group: "Workspace", keywords: "vendors subs directory" },
  { id: "price-book", label: "Price Book", hint: "Unit costs", href: "/dashboard/price-book", group: "Workspace", keywords: "costs assemblies rates" },
  { id: "procurement", label: "Procurement", hint: "Bids and purchase orders", href: "/dashboard/procurement", group: "Workspace", keywords: "rfq po vendors" },
  { id: "financials", label: "Financials", hint: "Invoices and lien waivers", href: "/dashboard/financials", group: "Workspace", keywords: "ar ap billing" },
  { id: "civil", label: "Civil Intelligence", hint: "Cut and fill volumes", href: "/dashboard/civil-intelligence", group: "Workspace", keywords: "earthwork mass haul" },
  { id: "marketing", label: "Marketing", hint: "Campaigns and leads", href: "/dashboard/marketing", group: "Workspace", keywords: "ads leads" },
  { id: "connections", label: "Connections", hint: "Cloud and account links", href: "/dashboard/settings/connections", group: "Settings", keywords: "oauth google drive dropbox connections" },
  { id: "team", label: "Team", hint: "Seats and invites", href: "/dashboard/settings/team", group: "Settings", keywords: "members users admin" },
  { id: "billing", label: "Billing", hint: "Plan and credits", href: "/dashboard/settings/billing", group: "Settings", keywords: "subscription paddle plan" },
  { id: "cost-overrides", label: "Cost Overrides", hint: "Company pricing adjustments", href: "/dashboard/settings/cost-overrides", group: "Settings", keywords: "markup rates" },
];

export function projectDestinations(projectId: string, projectName: string): Destination[] {
  const items: Destination[] = [];
  for (const section of PROJECT_SECTIONS) {
    for (const tab of section.tabs) {
      items.push({
        id: `${projectId}:${section.slug}:${tab.id}`,
        label: tab.label,
        hint: `${projectName} · ${section.id}`,
        href: projectSectionHref(projectId, section.slug, tab.id),
        group: "Project",
        keywords: `${section.keywords} ${tab.keywords} ${projectName}`,
      });
    }
  }
  return items;
}

export function filterDestinations(items: Destination[], query: string): Destination[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return items;

  const scored = items
    .map((item) => {
      const haystack = `${item.label} ${item.hint} ${item.keywords}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return null;
      const label = item.label.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (label.startsWith(token) ? 2 : label.includes(token) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((row): row is { item: Destination; score: number } => row !== null);

  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.map((row) => row.item);
}
