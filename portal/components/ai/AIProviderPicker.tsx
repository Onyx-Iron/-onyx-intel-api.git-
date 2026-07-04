"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Provider + model picker. Sits in the AI Command panel header. Persists via
 * PUT /api/ai/settings (cookies). Reads current state via GET on mount.
 *
 * Renders only providers with keys configured server-side — no dead options.
 */

type Provider = "gemini" | "openai" | "anthropic";

interface ModelOption { id: string; label: string; hint?: string }

interface SettingsResponse {
  configured: Provider[];
  models: Record<Provider, ModelOption[]>;
  preference: { provider: Provider | null; model: string | null };
}

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini:    "Gemini",
  openai:    "OpenAI",
  anthropic: "Claude",
};

const PROVIDER_DOT: Record<Provider, string> = {
  gemini:    "bg-[#CCFF00]",
  openai:    "bg-emerald-400",
  anthropic: "bg-amber-400",
};

export default function AIProviderPicker({ onChange }: { onChange?: (p: Provider, m: string) => void }) {
  const [state, setState] = useState<SettingsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: SettingsResponse) => { if (!cancelled) setState(data); })
      .catch(() => { if (!cancelled) setState({ configured: [], models: {} as Record<Provider, ModelOption[]>, preference: { provider: null, model: null } }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const effective = useMemo(() => {
    if (!state) return null;
    const provider = state.preference.provider ?? state.configured[0] ?? null;
    if (!provider) return null;
    const models = state.models[provider] ?? [];
    const model = state.preference.model ?? models[0]?.id ?? "";
    return { provider, model };
  }, [state]);

  const setPreference = async (provider: Provider, model: string) => {
    if (!state) return;
    setSaving(true);
    // Optimistic update — snap the pill before the round trip.
    setState({ ...state, preference: { provider, model } });
    try {
      const res = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      if (!res.ok) {
        // Revert
        const fresh = await fetch("/api/ai/settings", { cache: "no-store" }).then((r) => r.json());
        setState(fresh);
      } else {
        onChange?.(provider, model);
      }
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  if (!state) {
    return <span className="h-6 w-24 animate-pulse rounded-full bg-white/5" aria-hidden />;
  }

  if (state.configured.length === 0) {
    return <span className="text-xs text-white/40">No AI provider configured</span>;
  }

  const currentProvider = effective?.provider ?? state.configured[0];
  const currentModel    = effective?.model    ?? state.models[currentProvider]?.[0]?.id ?? "";
  const currentModelLabel = state.models[currentProvider]?.find((m) => m.id === currentModel)?.label ?? currentModel;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch AI provider + model"
        className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${PROVIDER_DOT[currentProvider]}`} />
        <span className="text-[11px] font-semibold text-white/80 group-hover:text-white">
          {PROVIDER_LABEL[currentProvider]}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 group-hover:text-white/60">
          {currentModelLabel}
        </span>
        <svg width="9" height="9" viewBox="0 0 12 12" className="text-white/40" aria-hidden>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-white/10 bg-[#0E0F12] shadow-2xl backdrop-blur-sm"
        >
          <div className="border-b border-white/5 px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Assistant</div>
          </div>

          {state.configured.map((p) => (
            <div key={p} className="border-b border-white/5 last:border-b-0">
              <div className="flex items-center gap-2 px-4 py-2">
                <span className={`h-1.5 w-1.5 rounded-full ${PROVIDER_DOT[p]}`} />
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">
                  {PROVIDER_LABEL[p]}
                </span>
              </div>
              {(state.models[p] ?? []).map((m) => {
                const active = p === currentProvider && m.id === currentModel;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPreference(p, m.id)}
                    disabled={saving}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-1.5 text-left text-xs transition-colors
                      ${active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}
                      disabled:opacity-50`}
                    role="menuitemradio"
                    aria-checked={active}
                  >
                    <span className={`${active ? "text-white" : "text-white/70"}`}>{m.label}</span>
                    <span className="flex items-center gap-2">
                      {m.hint && <span className="text-[9px] uppercase tracking-widest font-mono text-white/30">{m.hint}</span>}
                      {active && (
                        <svg width="10" height="10" viewBox="0 0 12 12" className="text-[#CCFF00]" aria-hidden>
                          <path d="M2.5 6.5l2.5 2.5 5-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
