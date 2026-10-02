"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "onyx_active_project_v1";

export interface ActiveProject {
  id: string;
  name: string;
  status?: string | null;
  city?: string | null;
  state?: string | null;
}

interface ProjectContextValue {
  projects: ActiveProject[];
  activeProjectId: string | null;
  activeProject: ActiveProject | null;
  setActiveProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ActiveProject[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setActiveProjectIdState(readStoredId());
    setHydrated(true);
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects?limit=200", { cache: "no-store" });
      const body = (await res.json()) as { projects?: ActiveProject[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const list = body.projects ?? [];
      setProjects(list);

      setActiveProjectIdState((current) => {
        const stored = current ?? readStoredId();
        if (stored && list.some((p) => p.id === stored)) return stored;
        if (list.length === 1) {
          writeStoredId(list[0].id);
          return list[0].id;
        }
        if (stored && !list.some((p) => p.id === stored)) {
          writeStoredId(null);
          return null;
        }
        return stored;
      });
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refreshProjects();
  }, [hydrated, refreshProjects]);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    writeStoredId(id);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const value = useMemo(
    () => ({
      projects,
      activeProjectId,
      activeProject,
      setActiveProjectId,
      refreshProjects,
      loading,
    }),
    [projects, activeProjectId, activeProject, setActiveProjectId, refreshProjects, loading],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return ctx;
}

/** Safe variant for optional usage outside the provider (tests / isolated trees). */
export function useOptionalProjectContext(): ProjectContextValue | null {
  return useContext(ProjectContext);
}
