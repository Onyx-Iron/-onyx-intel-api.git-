"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Ruler } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import ProjectScopeSelect, { filterByActiveProject } from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";
import { chooseOrCreateProjectHref } from "@/lib/navigation/project-sections";
import { needsReviewDecision, reviewTakeoffItem } from "@/lib/takeoff/reviewQueue";

interface TakeoffItem {
  id: string;
  project_id: string;
  label: string | null;
  type: string;
  quantity: number | null;
  unit: string | null;
  csi_code: string | null;
  review_status: string | null;
  source_method: string | null;
  created_at: string | null;
}

interface PlanDocument {
  id: string;
  file_name: string;
  project_id: string | null;
  takeoff_status: string | null;
}

interface UnprocessedSheet {
  id: string;
  project_id: string;
  document_id: string;
  page_number: number | null;
  processing_status: string;
  is_calibrated: boolean;
  file_name: string | null;
  project_name: string | null;
  updated_at: string;
}

const REVIEW_STYLES: Record<string, string> = {
  suggested: "bg-[#00D2FF]/10 text-[#00D2FF] border-[#00D2FF]/20",
  reviewed: "bg-white/5 text-white/60 border-white/10",
  approved: "bg-[#CCFF00]/10 text-[#CCFF00] border-[#CCFF00]/20",
  rejected: "bg-[#E50914]/10 text-[#E50914] border-[#E50914]/20",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonRows() {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <tr key={i}>
          {[...Array(6)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "60%" : "40%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function GlobalTakeoffPage() {
  const { projects, activeProjectId, activeProject } = useProjectContext();
  const [items, setItems] = useState<TakeoffItem[]>([]);
  const [openPlans, setOpenPlans] = useState<PlanDocument[]>([]);
  const [unprocessedSheets, setUnprocessedSheets] = useState<UnprocessedSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [queueOnly, setQueueOnly] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    const sheetsUrl = activeProjectId
      ? `/api/takeoff/unprocessed-sheets?project_id=${encodeURIComponent(activeProjectId)}&limit=50`
      : "/api/takeoff/unprocessed-sheets?limit=50";

    Promise.all([
      fetch("/api/takeoff/items?limit=500").then((r) => r.json()),
      fetch("/api/documents").then((r) => r.json()),
      fetch(sheetsUrl).then((r) => r.json()),
    ])
      .then(([takeoffRes, documentsRes, sheetsRes]: [unknown, unknown, unknown]) => {
        const t = takeoffRes as { items?: TakeoffItem[]; error?: string };
        const d = documentsRes as { documents?: PlanDocument[]; error?: string };
        const s = sheetsRes as { sheets?: UnprocessedSheet[]; error?: string };
        if (t.error) throw new Error(t.error);
        if (d.error) throw new Error(d.error);
        if (s.error) throw new Error(s.error);
        setItems(t.items ?? []);
        const docs = d.documents ?? [];
        setOpenPlans(
          docs.filter((doc) => {
            if (doc.takeoff_status === "done") return false;
            if (activeProjectId && doc.project_id !== activeProjectId) return false;
            return true;
          }),
        );
        setUnprocessedSheets(s.sheets ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [activeProjectId]);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const scoped = useMemo(
    () => filterByActiveProject(items, activeProjectId),
    [items, activeProjectId],
  );

  const suggestedQueue = useMemo(
    () => scoped.filter((item) => needsReviewDecision(item.review_status)),
    [scoped],
  );

  const filtered = useMemo(
    () => (queueOnly ? suggestedQueue : scoped),
    [queueOnly, suggestedQueue, scoped],
  );

  const totals = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const i of scoped) {
      const key = i.review_status ?? "unknown";
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    return byStatus;
  }, [scoped]);

  async function decide(itemId: string, action: "approve" | "reject") {
    setActingId(itemId);
    setReviewError(null);
    const result = await reviewTakeoffItem(itemId, action);
    if (!result.ok) {
      setReviewError(result.error);
      setActingId(null);
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, review_status: action === "approve" ? "approved" : "rejected" }
          : item,
      ),
    );
    setActingId(null);
  }

  const openWorkspaceHref = chooseOrCreateProjectHref(activeProject?.id, "takeoff", "takeoff");

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Takeoff"
        description={
          activeProject
            ? `Takeoff roll-up scoped to ${activeProject.name}`
            : "Every takeoff item across all projects, in one roll-up view"
        }
        compact
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {error && <div className="mb-4"><ErrorState message={error} onRetry={load} /></div>}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50">
            <Info size={12} className="shrink-0" />
            <span>
              Approve suggested findings here, or draw new takeoffs from a project&apos;s Takeoff tab.
              {activeProject && (
                <>
                  {" "}
                  <a href={openWorkspaceHref} className="text-[#CCFF00] hover:underline">
                    Open {activeProject.name} takeoff
                  </a>
                </>
              )}
            </span>
          </div>
          <ProjectScopeSelect className="w-56" label="" />
        </div>
        {reviewError && (
          <div className="mb-4 rounded-lg border border-[#E50914]/30 bg-[#E50914]/10 px-4 py-2 text-xs text-[#E50914]">
            {reviewError}
          </div>
        )}

        {!loading && (openPlans.length > 0 || unprocessedSheets.length > 0) && (
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            {openPlans.length > 0 && (
              <div className="rounded-xl border border-white/8 bg-[#0E0F12] px-4 py-3">
                <p className="text-[10px] uppercase tracking-widest text-white/40">Plans still in takeoff</p>
                <ul className="mt-2 space-y-1">
                  {openPlans.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-white/80">{doc.file_name}</span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#00D2FF]">
                        {doc.takeoff_status ?? "pending"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {unprocessedSheets.length > 0 && (
              <div className="rounded-xl border border-[#CCFF00]/20 bg-[#0E0F12] px-4 py-3">
                <p className="text-[10px] uppercase tracking-widest text-[#CCFF00]/70">Sheets needing calibration</p>
                <ul className="mt-2 space-y-1">
                  {unprocessedSheets.map((sheet) => {
                    const href = `/dashboard/projects/${sheet.project_id}?phase=takeoff&tab=takeoff`;
                    const label = sheet.file_name
                      ? `${sheet.file_name}${sheet.page_number != null ? ` · p.${sheet.page_number}` : ""}`
                      : `Sheet ${sheet.page_number ?? "?"}`;
                    return (
                      <li key={sheet.id} className="flex items-center justify-between gap-3 text-xs">
                        <a href={href} className="truncate text-white/80 hover:text-[#CCFF00] hover:underline">
                          {label}
                          {!activeProjectId && sheet.project_name && (
                            <span className="ml-1 text-white/40">({sheet.project_name})</span>
                          )}
                        </a>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#CCFF00]/80">
                          {sheet.processing_status}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {!loading && !error && scoped.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(totals).map(([status, count]) => (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${REVIEW_STYLES[status] ?? "bg-white/5 text-white/50 border-white/10"}`}
                >
                  {status}: {count}
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQueueOnly(true)}
                className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                  queueOnly ? "bg-[#00D2FF] text-black" : "border border-white/15 text-white/60"
                }`}
              >
                Needs decision ({suggestedQueue.length})
              </button>
              <button
                type="button"
                onClick={() => setQueueOnly(false)}
                className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                  !queueOnly ? "bg-white text-black" : "border border-white/15 text-white/60"
                }`}
              >
                All items
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#0A0A0B] border-b border-white/10">
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Item</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Project</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">CSI Code</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Quantity</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Review</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Created</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <SkeletonRows />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="py-4">
                        <EmptyState
                          icon={<Ruler className="w-6 h-6" />}
                          title={queueOnly ? "No suggested items waiting" : "No takeoff items yet"}
                          description={
                            queueOnly
                              ? "Approved and rejected findings stay on All items. Upload plans or open a project Takeoff tab to extract more."
                              : "Upload plans or pick a sheet in a project's Takeoff tab."
                          }
                          actionLabel={activeProject ? "Open takeoff" : "Choose or create a project"}
                          actionHref={openWorkspaceHref}
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const reviewKey = item.review_status && item.review_status in REVIEW_STYLES ? item.review_status : "unknown";
                    const pending = needsReviewDecision(item.review_status);
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white text-xs truncate max-w-xs">{item.label ?? "Untitled item"}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{projectNameById.get(item.project_id) ?? item.project_id}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.csi_code ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">
                          {item.quantity != null ? `${item.quantity} ${item.unit ?? ""}` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase ${REVIEW_STYLES[reviewKey] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                            {item.review_status ?? "unknown"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{fmt(item.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          {pending ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                disabled={actingId === item.id}
                                onClick={() => void decide(item.id, "approve")}
                                className="text-[10px] font-bold uppercase tracking-widest text-[#CCFF00] hover:underline disabled:opacity-40"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={actingId === item.id}
                                onClick={() => void decide(item.id, "reject")}
                                className="text-[10px] font-bold uppercase tracking-widest text-[#E50914] hover:underline disabled:opacity-40"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-white/30">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
