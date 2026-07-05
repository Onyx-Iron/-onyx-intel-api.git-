import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Command Center — Phase 1 dashboard.
 *
 * Three panels:
 *   1. Project List (companies-scoped)
 *   2. Quick Contact Directory
 *   3. Recent Audit Activity Feed (from the centralized audit_logs table)
 *
 * All data is server-fetched with the tenant-scoped service client. Nothing on
 * this page mutates — CRUD flows live in their own routes / pages.
 */
export default async function CommandCenterPage() {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Resolve company (auto-creates a 1:1 row against tenant on first visit)
  let { data: company } = await anyDb.from("companies").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!company) {
    const name = authTenantName(userId, orgSlug) ?? "My Workspace";
    const { data: created } = await anyDb.from("companies").insert({ tenant_id: tenantId, name, subscription_status: "trial" }).select("*").single();
    company = created;
  }

  const [projectsRes, contactsRes, auditRes] = await Promise.all([
    anyDb.from("projects").select("id, name, status, city, state, updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(25),
    anyDb.from("project_contacts").select("id, first_name, last_name, email, phone, role, project_id").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(60),
    anyDb.from("audit_logs").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(40),
  ]);

  const projects = (projectsRes.data ?? []) as Array<{ id: string; name: string; status: string | null; city: string | null; state: string | null; updated_at: string }>;
  const contacts = (contactsRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; role: string | null; project_id: string | null }>;
  const audits   = (auditRes.data ?? []) as Array<{ id: string; user_id: string | null; action_type: string; table_name: string; record_id: string; created_at: string }>;

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="min-h-screen bg-[#06070A] text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-6 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-mono text-white/40">Command Center</p>
            <h1 className="mt-1 text-3xl font-light tracking-tight">{company?.name ?? "Workspace"}</h1>
            <p className="mt-1 text-xs text-white/40">
              {projects.length} project{projects.length === 1 ? "" : "s"} · {contacts.length} contact{contacts.length === 1 ? "" : "s"} · subscription <span className="font-mono text-white/60">{company?.subscription_status ?? "trial"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/projects" className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white">All projects</Link>
            <Link href="/dashboard/contacts" className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/80 hover:border-white/30 hover:text-white">All contacts</Link>
          </div>
        </div>
      </div>

      {/* Three-panel grid */}
      <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-10 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {/* Project List */}
        <section className="rounded-xl border border-white/10 bg-[#0E0F12]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Project List</div>
            <span className="text-[10px] font-mono text-white/40">{projects.length}</span>
          </div>
          <div className="divide-y divide-white/5">
            {projects.length === 0 && (
              <div className="p-6 text-center text-sm text-white/40">
                No projects yet.
                <div className="mt-3">
                  <Link href="/dashboard/projects" className="text-[#CCFF00] hover:opacity-80">Create your first project →</Link>
                </div>
              </div>
            )}
            {projects.map((p) => (
              <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white group-hover:text-[#CCFF00]">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/40">
                    <span className={statusTone(p.status)}>{p.status ?? "—"}</span>
                    {(p.city || p.state) && <><span>·</span><span>{[p.city, p.state].filter(Boolean).join(", ")}</span></>}
                  </div>
                </div>
                <div className="text-[10px] font-mono text-white/30">{relTime(p.updated_at)}</div>
              </Link>
            ))}
          </div>
        </section>

        {/* Contact Directory */}
        <section className="rounded-xl border border-white/10 bg-[#0E0F12]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Contact Directory</div>
            <span className="text-[10px] font-mono text-white/40">{contacts.length}</span>
          </div>
          <div className="divide-y divide-white/5 max-h-[70vh] overflow-y-auto">
            {contacts.length === 0 && (
              <div className="p-6 text-center text-sm text-white/40">No contacts yet.</div>
            )}
            {contacts.map((c) => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Contact";
              return (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-semibold text-white">{name}</div>
                    {c.role && <span className="text-[9px] uppercase tracking-widest font-mono text-white/40 shrink-0">{c.role}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/50">
                    {c.email && <a href={`mailto:${c.email}`} className="hover:text-[#CCFF00]">{c.email}</a>}
                    {c.phone && <a href={`tel:${c.phone}`} className="hover:text-[#CCFF00]">{c.phone}</a>}
                  </div>
                  {c.project_id && projectNameById.has(c.project_id) && (
                    <div className="mt-0.5 text-[9px] uppercase tracking-widest font-mono text-white/30">
                      {projectNameById.get(c.project_id)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Audit Activity Feed */}
        <section className="rounded-xl border border-white/10 bg-[#0E0F12] lg:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Recent Audit Activity</div>
            <span className="text-[10px] font-mono text-white/40">{audits.length}</span>
          </div>
          <div className="divide-y divide-white/5 max-h-[70vh] overflow-y-auto">
            {audits.length === 0 && (
              <div className="p-6 text-center text-sm text-white/40">No audit entries yet.</div>
            )}
            {audits.map((a) => (
              <div key={a.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] uppercase tracking-widest font-mono ${actionTone(a.action_type)}`}>{a.action_type}</span>
                  <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest">{a.table_name}</span>
                  <span className="ml-auto text-[10px] font-mono text-white/30">{relTime(a.created_at)}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] font-mono text-white/50">
                  {a.record_id}
                </div>
                {a.user_id && <div className="mt-0.5 text-[10px] text-white/30">by {a.user_id.slice(0, 12)}</div>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function statusTone(s: string | null): string {
  if (!s) return "text-white/40";
  const v = s.toLowerCase();
  if (v.includes("active")) return "text-[#CCFF00]";
  if (v.includes("closed") || v.includes("archived")) return "text-white/40";
  if (v.includes("hold") || v.includes("paused")) return "text-amber-400";
  return "text-white/70";
}
function actionTone(a: string): string {
  if (a === "insert") return "text-[#CCFF00]";
  if (a === "delete") return "text-red-400";
  return "text-cyan-400";
}
function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
