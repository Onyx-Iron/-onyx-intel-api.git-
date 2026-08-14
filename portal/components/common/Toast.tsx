"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type ToastKind = "info" | "success" | "error" | "warning";

export interface ToastOptions {
  title: string;
  description?: string;
  kind?: ToastKind;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem {
  id: string;
  title: string;
  kind: ToastKind;
  duration: number;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
  dismiss: (id: string) => void;
  items: ToastItem[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: (opts: ToastOptions) => {
        if (typeof window !== "undefined") {
          console.warn("[toast]", opts.title, opts.description ?? "");
        }
      },
    };
  }
  return { toast: ctx.toast };
}

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const kind: ToastKind = opts.kind ?? "info";
    const duration = opts.duration ?? (kind === "error" ? 6000 : 4000);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item: ToastItem = {
      id,
      title: opts.title,
      description: opts.description,
      kind,
      duration,
      actionLabel: opts.actionLabel,
      onAction: opts.onAction,
    };
    setItems((prev) => [...prev, item].slice(-10));
    if (duration > 0) {
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss, items }}>
      {children}
    </ToastContext.Provider>
  );
}

function kindStyles(kind: ToastKind): { accent: string; icon: string } {
  switch (kind) {
    case "success":
      return { accent: "bg-lime-400", icon: "✓" };
    case "error":
      return { accent: "bg-[#E50914]", icon: "!" };
    case "warning":
      return { accent: "bg-amber-400", icon: "!" };
    default:
      return { accent: "bg-white/70", icon: "i" };
  }
}

export function Toaster() {
  const ctx = useContext(ToastContext);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ctx || !mounted || typeof document === "undefined") return null;

  const visible = ctx.items.slice(-MAX_VISIBLE);

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[9999] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      {visible.map((t) => {
        const { accent, icon } = kindStyles(t.kind);
        return (
          <div
            key={t.id}
            className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0E0F12] shadow-lg shadow-black/40 animate-in fade-in slide-in-from-right-4"
            role="status"
          >
            <div className={`absolute left-0 top-0 h-full w-1 ${accent}`} />
            <div className="flex items-start gap-3 py-3 pl-4 pr-3">
              <div
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${accent} text-[10px] font-bold text-black`}
              >
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{t.title}</div>
                {t.description ? (
                  <div className="mt-0.5 break-words text-xs text-white/60">{t.description}</div>
                ) : null}
                {t.actionLabel && t.onAction ? (
                  <button
                    type="button"
                    onClick={() => {
                      t.onAction?.();
                      ctx.dismiss(t.id);
                    }}
                    className="mt-2 inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.03] px-3 text-[10px] font-bold uppercase tracking-widest text-white/75 hover:border-white/25 hover:text-white"
                  >
                    {t.actionLabel}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => ctx.dismiss(t.id)}
                className="ml-1 shrink-0 rounded p-1 text-white/40 transition hover:bg-white/5 hover:text-white"
                aria-label="Dismiss notification"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
