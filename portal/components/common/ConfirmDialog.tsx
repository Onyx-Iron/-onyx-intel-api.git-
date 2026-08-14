"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return {
      confirm: async (opts: ConfirmOptions) => {
        if (typeof window === "undefined" || typeof document === "undefined") return false;
        return new Promise<boolean>((resolve) => {
          const root = document.createElement("div");
          document.body.appendChild(root);
          const cleanup = (value: boolean) => {
            resolve(value);
            root.remove();
          };

          root.innerHTML = `
            <div class="fixed inset-0 z-[10000] flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <div data-confirm-backdrop class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
              <div class="relative w-full max-w-md rounded-lg border border-white/10 bg-[#0E0F12] shadow-2xl shadow-black/60">
                <div class="px-6 pt-5 pb-4">
                  <h2 class="text-lg font-semibold text-white">${escapeHtml(opts.title)}</h2>
                  ${opts.description ? `<p class="mt-2 text-sm text-white/60">${escapeHtml(opts.description)}</p>` : ""}
                </div>
                <div class="flex items-center justify-end gap-2 border-t border-white/5 px-6 py-3">
                  <button type="button" data-confirm-cancel class="rounded-md border border-white/10 bg-transparent px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5 hover:text-white">
                    ${escapeHtml(opts.cancelLabel ?? "Cancel")}
                  </button>
                  <button type="button" data-confirm-ok class="${opts.destructive ? "rounded-md bg-[#E50914] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c4080f]" : "rounded-md bg-lime-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-lime-300"}">
                    ${escapeHtml(opts.confirmLabel ?? "Confirm")}
                  </button>
                </div>
              </div>
            </div>
          `;
          const backdrop = root.querySelector("[data-confirm-backdrop]");
          const cancel = root.querySelector("[data-confirm-cancel]");
          const ok = root.querySelector("[data-confirm-ok]");
          backdrop?.addEventListener("click", () => cleanup(false));
          cancel?.addEventListener("click", () => cleanup(false));
          ok?.addEventListener("click", () => cleanup(true));
          window.addEventListener("keydown", function onKey(e) {
            if (e.key === "Escape") {
              window.removeEventListener("keydown", onKey);
              cleanup(false);
            }
          });
        });
      },
    };
  }
  return ctx;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      if (pending) {
        pending.resolve(value);
        setPending(null);
      }
    },
    [pending],
  );

  // Body scroll lock
  useEffect(() => {
    if (!pending) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pending]);

  // Keyboard handlers
  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", handler);
    // Focus confirm button shortly after mount
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(t);
    };
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
            >
              <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={() => close(false)}
              />
              <div className="relative w-full max-w-md rounded-lg border border-white/10 bg-[#0E0F12] shadow-2xl shadow-black/60">
                <div className="px-6 pt-5 pb-4">
                  <h2
                    id="confirm-dialog-title"
                    className="text-lg font-semibold text-white"
                  >
                    {pending.title}
                  </h2>
                  {pending.description ? (
                    <p className="mt-2 text-sm text-white/60">
                      {pending.description}
                    </p>
                  ) : null}
                  {pending.destructive ? (
                    <p className="mt-2 text-[11px] uppercase tracking-widest text-red-300/80">
                      This action cannot be undone.
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-white/5 px-6 py-3">
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="rounded-md border border-white/10 bg-transparent px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/5 hover:text-white"
                  >
                    {pending.cancelLabel ?? "Cancel"}
                  </button>
                  <button
                    type="button"
                    ref={confirmBtnRef}
                    onClick={() => close(true)}
                    className={
                      pending.destructive
                        ? "rounded-md bg-[#E50914] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#c4080f] focus:outline-none focus:ring-2 focus:ring-[#E50914]/50"
                        : "rounded-md bg-lime-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-lime-300 focus:outline-none focus:ring-2 focus:ring-lime-400/50"
                    }
                  >
                    {pending.confirmLabel ?? "Confirm"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfirmContext.Provider>
  );
}
