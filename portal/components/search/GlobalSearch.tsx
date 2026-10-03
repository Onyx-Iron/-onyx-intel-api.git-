"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Folder, FileText, Users, Sparkles, Loader2, CornerDownLeft } from "lucide-react";
import { useOptionalProjectContext } from "@/components/project/ProjectContext";
import {
  filterDestinations,
  projectDestinations,
  WORKSPACE_DESTINATIONS,
  type Destination,
} from "@/lib/navigation/destinations";

type SearchKind = "project" | "document" | "contact" | "generated_document";

type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string;
  project_id?: string | null;
  snippet?: string | null;
};

type SearchResponse = {
  results?: SearchResult[];
  error?: string;
};

const KIND_META: Record<
  SearchKind,
  { label: string; icon: typeof Folder; order: number }
> = {
  project: { label: "Projects", icon: Folder, order: 1 },
  document: { label: "Documents", icon: FileText, order: 2 },
  contact: { label: "Contacts", icon: Users, order: 3 },
  generated_document: { label: "Generated reports", icon: Sparkles, order: 4 },
};

function hrefFor(r: SearchResult): string {
  switch (r.kind) {
    case "project":
      return `/dashboard/projects/${r.id}`;
    case "document":
      return r.project_id
        ? `/dashboard/projects/${r.project_id}?phase=documents&tab=documents`
        : "/dashboard/documents";
    case "contact":
      return "/dashboard/contacts";
    case "generated_document":
      // There is no /dashboard/generated-docs page — land on the project
      // overview (or Reports roll-up) where generated docs are surfaced.
      return r.project_id
        ? `/dashboard/projects/${r.project_id}?phase=overview&tab=summary`
        : "/dashboard/reports";
  }
}

export default function GlobalSearch() {
  const projectCtx = useOptionalProjectContext();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setLoading(false);
      setError(null);
      if (abortRef.current) abortRef.current.abort();
      return;
    }

    const handle = window.setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (res) => {
          const body: SearchResponse = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || `Search failed (${res.status})`);
          setResults(Array.isArray(body.results) ? body.results : []);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : String(err));
          setResults([]);
        })
        .finally(() => {
          if (abortRef.current === controller) setLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [query]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const jumps = useMemo(() => {
    const active = projectCtx?.activeProject;
    const project = active ? projectDestinations(active.id, active.name) : [];
    const primaryProject = project.filter(
      (item, index, all) => all.findIndex((other) => other.hint === item.hint) === index,
    );
    const catalog = [...primaryProject, ...WORKSPACE_DESTINATIONS];
    const trimmedQuery = query.trim();
    return (trimmedQuery ? filterDestinations(catalog, trimmedQuery) : catalog).slice(0, 6);
  }, [projectCtx, query]);

  const grouped = useMemo(() => {
    const map = new Map<SearchKind, SearchResult[]>();
    for (const r of results) {
      const arr = map.get(r.kind) ?? [];
      arr.push(r);
      map.set(r.kind, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) => KIND_META[a[0]].order - KIND_META[b[0]].order,
    );
  }, [results]);

  const showDropdown = open && (query.trim().length > 0 || true);
  const trimmed = query.trim();

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
      <Search
        size={13}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search or jump to a function…"
        aria-label="Search projects, documents, contacts, and functions"
        className="h-9 w-full rounded-full border border-white/10 bg-white/[0.03] pl-9 pr-9 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#CCFF00]/40"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            setResults([]);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/40 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40"
        >
          <X size={12} />
        </button>
      ) : null}

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[420px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0B0D12] shadow-2xl shadow-black/40 sm:left-auto sm:right-0 sm:w-[420px]">
          {jumps.length > 0 && (
            <div className="border-b border-white/8 px-2 py-2">
              <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                {trimmed ? "Go to" : "Jump"}
              </div>
              <ul>
                {jumps.map((item: Destination) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-white">{item.label}</span>
                        <span className="block truncate text-[11px] text-white/40">{item.hint}</span>
                      </span>
                      <CornerDownLeft size={12} className="shrink-0 text-white/25" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!trimmed ? null : loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-white/55">
              <Loader2 size={12} className="animate-spin" />
              Searching…
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center text-xs text-red-300/80">
              {error}
            </div>
          ) : results.length === 0 ? (
            jumps.length > 0 ? null : (
              <div className="px-4 py-6 text-center text-xs text-white/45">
                No matches for &ldquo;{trimmed}&rdquo;.
              </div>
            )
          ) : (
            <ul className="py-2">
              {grouped.map(([kind, items]) => {
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                return (
                  <li key={kind} className="px-2 pb-2">
                    <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                      {meta.label}
                    </div>
                    <ul>
                      {items.map((r) => (
                        <li key={`${r.kind}-${r.id}`}>
                          <Link
                            href={hrefFor(r)}
                            onClick={() => setOpen(false)}
                            className="flex items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
                          >
                            <span className="mt-[2px] flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white/[0.04] text-[#CCFF00]">
                              <Icon size={13} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-white">
                                {r.title}
                              </span>
                              {r.snippet ? (
                                <span className="block truncate text-[11px] text-white/45">
                                  {r.snippet}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
