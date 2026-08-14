"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  normalizeProjectSyncSnapshot,
  type ProjectSyncSnapshot,
} from "@/lib/projects/sync";

interface ProjectSyncContextValue {
  projectId: string;
  revision: number | null;
  updatedAt: string | null;
  lastTable: string | null;
  connected: boolean;
  refresh: () => Promise<void>;
}

const ProjectSyncContext = createContext<ProjectSyncContextValue | null>(null);

export default function ProjectSyncProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ProjectSyncSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const revisionRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const acceptSnapshot = useCallback((next: ProjectSyncSnapshot, broadcast: boolean) => {
    if (next.project_id !== projectId) return;
    const previous = revisionRef.current;
    if (previous !== null && next.revision < previous) return;
    revisionRef.current = next.revision;
    setSnapshot(next);
    setConnected(true);

    if (previous !== null && next.revision > previous) {
      window.dispatchEvent(new CustomEvent("onyx:project-sync", { detail: next }));
      if (broadcast) channelRef.current?.postMessage(next);
    }
  }, [projectId]);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const since = revisionRef.current;
    const params = since === null ? "" : `?since=${encodeURIComponent(String(since))}`;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sync${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Project sync returned ${response.status}`);
      const next = normalizeProjectSyncSnapshot(await response.json());
      if (!next) throw new Error("Project sync returned an invalid response");
      acceptSnapshot(next, true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setConnected(false);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [acceptSnapshot, projectId]);

  useEffect(() => {
    revisionRef.current = null;

    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`onyx-project-${projectId}`);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const next = normalizeProjectSyncSnapshot(event.data);
        if (next) acceptSnapshot(next, false);
      };
    }

    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5_000);
    const refreshWhenActive = () => void refresh();
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      requestRef.current?.abort();
      requestRef.current = null;
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [acceptSnapshot, projectId, refresh]);

  return (
    <ProjectSyncContext.Provider value={{
      projectId,
      revision: snapshot?.project_id === projectId ? snapshot.revision : null,
      updatedAt: snapshot?.project_id === projectId ? snapshot.updated_at : null,
      lastTable: snapshot?.project_id === projectId ? snapshot.last_table : null,
      connected: connected && snapshot?.project_id === projectId,
      refresh,
    }}>
      {children}
    </ProjectSyncContext.Provider>
  );
}

export function useProjectSync() {
  return useContext(ProjectSyncContext);
}

/** Refreshes a mounted tab after a newer database revision arrives. */
export function useProjectSyncRefresh(refreshData: () => unknown | Promise<unknown>) {
  const sync = useProjectSync();
  const callbackRef = useRef(refreshData);
  const seenRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = refreshData;
  }, [refreshData]);

  useEffect(() => {
    const revision = sync?.revision;
    if (revision === null || revision === undefined) return;
    if (seenRevisionRef.current === null) {
      seenRevisionRef.current = revision;
      return;
    }
    if (revision > seenRevisionRef.current) {
      seenRevisionRef.current = revision;
      void callbackRef.current();
    }
  }, [sync?.revision]);
}
