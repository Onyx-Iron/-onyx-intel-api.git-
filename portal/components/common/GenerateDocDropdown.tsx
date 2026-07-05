"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles, Check, AlertCircle } from "lucide-react";
import { GENERATED_DOC_TYPES } from "@/lib/ai/generatedDocTypes";

interface GenerateDocDropdownProps {
  projectId: string;
  sourceDocumentId?: string;
  label?: string;
  variant?: "primary" | "ghost";
  onGenerated?: (doc: { id: string; doc_type: string; title: string; content: string }) => void;
}

type Status = "idle" | "generating" | "done" | "error";

/**
 * One dropdown to generate any of the 9 supported doc types.
 * Designed for the post-upload flow: pick a type → generate → result is saved
 * to /api/generated-docs and surfaced under the project's AI Docs tab.
 *
 * sourceDocumentId optionally passes a just-uploaded document's id so the
 * generator uses its parsed pages as grounding context.
 */
export default function GenerateDocDropdown({
  projectId,
  sourceDocumentId,
  label = "Generate Document",
  variant = "ghost",
  onGenerated,
}: GenerateDocDropdownProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const generate = async (typeKey: string) => {
    // Guard against double-fire from rapid clicks creating duplicate docs
    if (busyKey !== null) return;
    setBusyKey(typeKey);
    setStatus("generating");
    setStatusMsg("Generating…");
    try {
      const res = await fetch("/api/generated-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          doc_type: typeKey,
          source_document_id: sourceDocumentId,
        }),
      });
      const body = await res.json().catch(() => ({})) as {
        doc?: { id: string; doc_type: string; title: string; content: string };
        error?: string;
        code?: string;
      };
      if (!res.ok || !body.doc) {
        if (body.code === "NO_PROVIDER" || res.status === 503) {
          setStatusMsg("AI is not configured.");
        } else {
          setStatusMsg(body.error ?? `Failed (HTTP ${res.status})`);
        }
        setStatus("error");
        setTimeout(() => setStatus("idle"), 4000);
        return;
      }
      onGenerated?.(body.doc);
      setStatus("done");
      setStatusMsg(`Saved: ${body.doc.title}`);
      setOpen(false);
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    } finally {
      setBusyKey(null);
    }
  };

  const triggerCls = variant === "primary"
    ? "inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:opacity-50"
    : "inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-xs font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50";

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={status === "generating"}
        className={triggerCls}
      >
        <Sparkles size={13} />
        {status === "generating" ? "Generating…" : label}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0E0F12] shadow-2xl">
          <div className="border-b border-white/8 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]/70">Generate from this project</p>
            <p className="mt-1 text-[11px] text-white/45">
              {sourceDocumentId ? "Uses the just-uploaded plan as context." : "Uses live project data as context."}
            </p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {GENERATED_DOC_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => generate(t.key)}
                disabled={busyKey !== null}
                className="group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white group-hover:text-[#CCFF00]">{t.label}</p>
                  <p className="mt-0.5 text-[11px] text-white/40">{t.hint}</p>
                </div>
                {busyKey === t.key && (
                  <span className="mt-1 h-1.5 w-1.5 animate-pulse rounded-full bg-[#CCFF00]" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {status !== "idle" && statusMsg && (
        <div className="absolute right-0 top-12 z-40 flex items-center gap-2 rounded-lg border border-white/10 bg-[#0E0F12] px-3 py-2 text-[11px] shadow-xl">
          {status === "done" && <Check size={12} className="text-[#CCFF00]" />}
          {status === "error" && <AlertCircle size={12} className="text-red-400" />}
          {status === "generating" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#CCFF00]" />}
          <span className={status === "error" ? "text-red-400" : "text-white/70"}>{statusMsg}</span>
        </div>
      )}
    </div>
  );
}
