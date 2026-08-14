"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, Bot, BookOpen, Briefcase, Calendar, CheckSquare,
  ClipboardCheck, DollarSign, FileText, GitBranch, MessageSquare,
  RefreshCw, Ruler, Shield, ShoppingCart, StickyNote, User,
} from "lucide-react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";

interface ProjectEvent {
  id: string;
  entity_type: string;
  action: string;
  title: string;
  meta: Record<string, unknown>;
  created_at: string;
  user_id: string;
  icon?: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  MessageSquare, Calendar, FileText, DollarSign, Ruler,
  ClipboardCheck, CheckSquare, User, ShoppingCart, GitBranch,
  BookOpen, StickyNote, Bot, Shield, Briefcase, Activity,
};

const ENTITY_LABELS: Record<string, string> = {
  rfi: "RFI",
  schedule: "Schedule",
  document: "Document",
  estimate: "Estimate",
  takeoff: "Takeoff",
  permit: "Permit",
  punch_list: "Punch List",
  contact: "Contact",
  procurement: "Procurement",
  change_order: "Change Order",
  daily_log: "Daily Log",
  note: "Note",
  ai_chat: "AI Chat",
  ai_digest: "Risk Digest",
  project: "Project",
};

const ACTION_COLORS: Record<string, string> = {
  created: "text-emerald-400",
  uploaded: "text-blue-400",
  processed: "text-purple-400",
  generated: "text-[#CCFF00]",
  updated: "text-amber-400",
  status_changed: "text-amber-400",
  deleted: "text-red-400",
  submitted: "text-blue-400",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EventIcon({ iconName, entityType }: { iconName?: string; entityType: string }) {
  const fallbacks: Record<string, string> = {
    rfi: "MessageSquare", schedule: "Calendar", document: "FileText",
    estimate: "DollarSign", takeoff: "Ruler", permit: "ClipboardCheck",
    punch_list: "CheckSquare", contact: "User", procurement: "ShoppingCart",
    change_order: "GitBranch", daily_log: "BookOpen", note: "StickyNote",
    ai_chat: "Bot", ai_digest: "Shield", project: "Briefcase",
  };
  const name = iconName ?? fallbacks[entityType] ?? "Activity";
  const Icon = ICON_MAP[name] ?? Activity;
  return <Icon size={13} />;
}

export default function ActivityFeed({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ project_id: projectId, page: "1", limit: "5" });
      const res = await fetch(`/api/activity?${params}`);
      const data = (await res.json().catch(() => ({}))) as { events?: ProjectEvent[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not load recent activity (${res.status}). Refresh and try again.`);
      setEvents((data.events ?? []).slice(0, 5));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load recent activity. Refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useProjectSyncRefresh(fetchEvents);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      fetchEvents();
    }
  }, [fetchEvents]);

  const refresh = () => {
    loadedRef.current = false;
    fetchEvents();
    loadedRef.current = true;
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#16161A] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-[#CCFF00]" />
          <span className="text-[11px] uppercase tracking-widest text-gray-400">Recent Activity</span>
        </div>
        <button onClick={refresh} disabled={loading} aria-label="Refresh activity" className="min-h-[40px] text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-40">
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="divide-y divide-white/5">
        {loadError ? (
          <div className="px-4 py-8 text-center text-xs text-amber-200">
            <div className="font-semibold">Recent activity could not load.</div>
            <div className="mt-1 text-amber-200/80">{loadError}</div>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 inline-flex h-8 items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-3 text-[10px] font-bold uppercase tracking-widest text-amber-100 transition-colors hover:border-amber-300/30 hover:bg-amber-300/15"
            >
              Retry
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="h-7 w-7 rounded-lg bg-white/5 animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5 pt-1">
                  <div className="h-3 bg-white/5 rounded animate-pulse" style={{ width: `${70 - i * 8}%` }} />
                  <div className="h-2.5 bg-white/5 rounded animate-pulse w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Activity size={20} className="text-gray-700" />
            <p className="text-xs text-gray-600">No activity yet. Upload a plan, create a task, or make a project update and this feed will fill in automatically.</p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="flex gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 ${ACTION_COLORS[event.action] ?? "text-gray-500"}`}>
                <EventIcon iconName={event.icon} entityType={event.entity_type} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-200 leading-snug truncate">{event.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-600">{ENTITY_LABELS[event.entity_type] ?? event.entity_type}</span>
                  <span className="text-[10px] text-gray-700">•</span>
                  <span className="text-[10px] text-gray-600">{timeAgo(event.created_at)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
