import { redirect } from "next/navigation";

// Reconciled with /dashboard (frontend-backend reconciliation, item 2) —
// this page and /dashboard were two separate, overlapping Command Center
// implementations. /dashboard (OnyxIntelDashboard) is the far more complete
// one (project pipeline, schedule/risk, document intelligence, AI command
// panel, Google Calendar/Gmail) and is what the Sidebar's "Overview" link
// already points to, so it's kept as the one authoritative implementation.
// This page's two panels that weren't already covered there — the raw
// audit-activity feed and a contact directory glance — were ported into
// OnyxIntelDashboard as RecentContactsCard/AuditActivityCard rather than
// dropped. This route now just redirects so any existing bookmarked/shared
// links to /dashboard/command-center keep working instead of 404ing.
export default function CommandCenterRedirect() {
  redirect("/dashboard");
}
