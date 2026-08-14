"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/common/Toast";

const PENDING_RECONNECT_KEY = "onyx_pending_google_reconnect_v1";

function GoogleG() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 16.3 3 9.7 7.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.6 40.6 16.2 45 24 45z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.5 36.4 44 31 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
interface ConnectionStatus {
  connected: boolean;
  email?: string | null;
  drive_folder_url?: string | null;
}
export default function GoogleConnect({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [pendingReconnect] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(PENDING_RECONNECT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setStatusError(null);
    try {
      const res = await fetch("/api/google/status");
      const data = await res.json().catch(() => ({})) as Partial<ConnectionStatus> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not load Google connection status (${res.status}). Refresh and try again.`);
      setStatus({ connected: Boolean(data.connected), email: data.email ?? null, drive_folder_url: data.drive_folder_url ?? null });
    } catch (err) {
      if (typeof window !== "undefined" && window.location.search.includes("google=")) {
        setStatus({ connected: false });
        return;
      }
      setStatusError(err instanceof Error ? err.message : "Could not load Google connection status.");
      toast({
        title: err instanceof Error ? err.message : "Could not load Google connection status.",
        description: "Reconnect Google if the card keeps showing disconnected.",
        kind: "warning",
      });
      setStatus({ connected: false });
    }
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!status?.connected || typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(PENDING_RECONNECT_KEY) === "1") {
        window.localStorage.removeItem(PENDING_RECONNECT_KEY);
        toast({
          title: "Google is connected",
          description: "Resume the interrupted upload from the project header or Documents tab.",
          kind: "success",
        });
      }
    } catch {
      // ignore storage failures
    }
  }, [status?.connected, toast]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("google=")) {
      const t = setTimeout(refresh, 600);
      return () => clearTimeout(t);
    }
  }, [refresh]);

  // Close menu on outside click / Escape
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

  const connect = () => {
    try {
      window.localStorage.setItem(PENDING_RECONNECT_KEY, "1");
    } catch {
      // ignore storage failures
    }
    setBusy(true);
    window.location.href = "/api/google/connect";
  };

  const reconnect = () => {
    try {
      window.localStorage.setItem(PENDING_RECONNECT_KEY, "1");
    } catch {
      // ignore storage failures
    }
    setBusy(true);
    // Same URL - Google will re-prompt for missing scopes if needed
    window.location.href = "/api/google/connect";
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/google/status", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Disconnect failed (${res.status}). Refresh and try again.`);
      }
      setStatus({ connected: false });
      setOpen(false);
      setDisconnectConfirmOpen(false);
      toast({
        title: "Google disconnected",
        description: "Drive imports and auto-save will resume when you reconnect.",
        kind: "info",
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Disconnect failed. Refresh and try again.",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  if (status === null) {
    return <div className={`${compact ? "h-9 w-9" : "h-10 w-10"} animate-pulse rounded-full bg-white/5`} />;
  }

  if (statusError && !status.connected) {
    return (
      <button
        type="button"
        onClick={() => void refresh()}
        title={statusError}
        className={`${compact ? "h-9" : "h-10"} flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 text-xs font-semibold text-amber-100 transition-colors hover:border-amber-300/30 hover:bg-amber-300/15`}
      >
        <GoogleG /> Retry Google
      </button>
    );
  }

  // ── Not connected: prominent CTA ─────────────────────────────────────────
  if (!status.connected) {
    return (
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        title={pendingReconnect ? "Reconnect Google so you can retry the interrupted upload" : "Connect your Google account for Drive imports + auto-save reports to Drive"}
        className={`${compact ? "h-9" : "h-10"} flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-xs font-semibold text-white/80 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50`}
      >
        <GoogleG /> {busy ? "Connecting..." : pendingReconnect ? "Reconnect Google" : "Connect Google"}
        {pendingReconnect && !busy && (
          <span className="rounded-full border border-[#CCFF00]/25 bg-[#CCFF00]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#CCFF00]">
            Resume
          </span>
        )}
      </button>
    );
  }

  // ── Connected: quiet icon-first trigger + dropdown ───────────────────────
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={status.email ? `Google · ${status.email}` : "Google linked"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${compact ? "h-9" : "h-10"} group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pl-2.5 pr-3 transition-colors hover:border-white/20 hover:bg-white/[0.06]`}
      >
        <span className="relative flex items-center justify-center">
          <GoogleG />
          <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#CCFF00] ring-2 ring-[#06070A]" />
        </span>
        <span className="text-[11px] font-semibold text-white/70 group-hover:text-white/90">Linked</span>
        <svg width="9" height="9" viewBox="0 0 12 12" className="text-white/40" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-white/10 bg-[#0E0F12] shadow-2xl backdrop-blur-sm"
        >
          <div className="border-b border-white/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <GoogleG />
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Signed in</span>
            </div>
            <div className="mt-1 truncate text-xs font-medium text-white/90" title={status.email ?? undefined}>
              {status.email ?? "Google account"}
            </div>
          </div>

          {status.drive_folder_url && (
            <a
              href={status.drive_folder_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-4 py-2.5 text-xs text-white/80 transition-colors hover:bg-white/[0.03]"
              onClick={() => setOpen(false)}
            >
              <span>Open workspace Drive folder</span>
              <svg width="12" height="12" viewBox="0 0 12 12" className="text-white/40" aria-hidden="true">
                <path d="M4 2h6v6M10 2L4 8M2 5v5h5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </svg>
            </a>
          )}

          <button
            type="button"
            onClick={reconnect}
            disabled={busy}
            className="w-full px-4 py-2.5 text-left text-xs text-white/80 transition-colors hover:bg-white/[0.03] disabled:opacity-50"
          >
            Reconnect &amp; refresh permissions
          </button>

          <div className="my-1 border-t border-white/5" />

          <button
            type="button"
            onClick={() => setDisconnectConfirmOpen(true)}
            disabled={busy}
            className="w-full px-4 py-2.5 text-left text-xs text-red-400 transition-colors hover:bg-red-400/[0.06] disabled:opacity-50"
          >
            Disconnect Google
          </button>
        </div>
      )}

      {disconnectConfirmOpen && (
        <ConfirmDisconnectModal
          busy={busy}
          onCancel={() => setDisconnectConfirmOpen(false)}
          onConfirm={() => void disconnect()}
        />
      )}
    </div>
  );
}
function ConfirmDisconnectModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-5 shadow-2xl">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white">Disconnect Google?</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          Auto-save to Drive and Drive imports will stop until you reconnect.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full bg-red-500 px-4 text-[11px] font-bold uppercase tracking-widest text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      </div>
    </div>
  );
}
