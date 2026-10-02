"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/common/EmptyState";

interface Memory {
  id: string;
  fact: string;
  created_at: string;
}

export default function ProjectMemoryPanel({ projectId }: { projectId: string }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memories`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMemories(body.memories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function extract() {
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memories/extract`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMemories(body.memories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function addFact(event: React.FormEvent) {
    event.preventDefault();
    const fact = draft.trim();
    if (!fact || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMemories(body.memories ?? []);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(memoryId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memories?memory_id=${memoryId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="rounded-xl border border-white/8 bg-[#0E0F12] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
            <Brain size={12} className="text-[#CCFF00]" />
            Project memory
          </p>
          <p className="mt-1 text-xs text-white/45">
            Durable facts shared across Takeoff, Estimating, Field, Reports, and AI chat.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void extract()}
          disabled={extracting}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-[#CCFF00]/30 hover:text-[#CCFF00] disabled:opacity-40"
        >
          <RefreshCw size={11} className={extracting ? "animate-spin" : ""} />
          {extracting ? "Extracting" : "Refresh from project"}
        </button>
      </div>

      {error && (
        <div className="mb-3">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      ) : memories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-xs text-white/35">
          No shared memory yet. Extract facts from documents and project state, or add one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li
              key={m.id}
              className="group flex items-start gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5"
            >
              <p className="flex-1 text-sm text-white/75">{m.fact}</p>
              <button
                type="button"
                onClick={() => void remove(m.id)}
                className="shrink-0 rounded p-1 text-white/20 opacity-0 transition-opacity hover:text-[#E50914] group-hover:opacity-100"
                aria-label="Remove memory"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addFact} className="mt-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a lasting project fact…"
          className="h-9 flex-1 rounded-lg border border-white/10 bg-[#06070A] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#CCFF00]/40"
        />
        <button
          type="submit"
          disabled={!draft.trim() || saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#CCFF00] px-3 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-40"
        >
          <Plus size={12} /> Add
        </button>
      </form>
    </section>
  );
}
