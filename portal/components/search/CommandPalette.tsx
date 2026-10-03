"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useOptionalProjectContext } from "@/components/project/ProjectContext";
import {
  filterDestinations,
  projectDestinations,
  WORKSPACE_DESTINATIONS,
  type Destination,
} from "@/lib/navigation/destinations";

export const OPEN_COMMAND_PALETTE = "onyx-open-command-palette";

export function requestCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE));
}

export default function CommandPalette() {
  const router = useRouter();
  const projectCtx = useOptionalProjectContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const destinations = useMemo(() => {
    const active = projectCtx?.activeProject;
    const project = active ? projectDestinations(active.id, active.name) : [];
    return [...project, ...WORKSPACE_DESTINATIONS];
  }, [projectCtx]);

  const results = useMemo(() => filterDestinations(destinations, query).slice(0, 12), [destinations, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setActiveIndex(0);
      }
    }
    function onOpen() {
      setOpen(true);
      setQuery("");
      setActiveIndex(0);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [query]);

  function go(item: Destination) {
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]" role="presentation">
      <button
        type="button"
        aria-label="Close jump menu"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a function"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0B0D12] shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-2 border-b border-white/8 px-4">
          <Search size={14} className="text-white/35" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                go(results[activeIndex]);
              }
            }}
            placeholder="Jump to takeoff, invoices, RFIs, settings…"
            aria-label="Jump to a function"
            className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        <ul className="max-h-[360px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-white/45">No function matches that.</li>
          ) : (
            results.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${
                    index === activeIndex ? "bg-white/[0.05]" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white">{item.label}</span>
                    <span className="block truncate text-[11px] text-white/40">{item.hint}</span>
                  </span>
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-white/30">
                    {item.group}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-white/8 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-white/30">
          Enter opens · Esc closes
        </div>
      </div>
    </div>
  );
}
