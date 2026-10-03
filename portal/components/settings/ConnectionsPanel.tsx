"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import GoogleConnect from "@/components/google/GoogleConnect";

interface ConnectionChip {
  provider: string;
  label: string;
  connected: boolean;
  accountLabel?: string | null;
  status?: string;
  statusDetail?: string | null;
  supportsOAuth: boolean;
  note?: string;
}

const CONNECT_HREF: Record<string, string> = {
  dropbox: "/api/connections/dropbox/connect",
  sharefile: "/api/connections/sharefile/connect",
  meta: "/api/connections/meta/connect",
  gbp: "/api/connections/gbp/connect",
  gsc: "/api/connections/gsc/connect",
  linkedin: "/api/connections/linkedin/connect",
};

export default function ConnectionsPanel() {
  const [connections, setConnections] = useState<ConnectionChip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error(`Failed to load connections (${res.status})`);
      const data = await res.json() as { connections: ConnectionChip[] };
      setConnections(data.connections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
  useEffect(() => { void refresh(); }, [refresh]);

  const disconnect = async (provider: string) => {
    if (!confirm(`Disconnect ${provider}?`)) return;
    setBusy(provider);
    try {
      const res = await fetch(`/api/connections?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
      const data = await res.json() as { connections: ConnectionChip[] };
      setConnections(data.connections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-white/40">Loading connections…</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Google Workspace</h3>
            <p className="text-xs text-white/40">Drive, Gmail, Calendar, Docs — existing OAuth</p>
          </div>
          <GoogleConnect />
        </div>
      </div>

      <ul className="space-y-2">
        {connections
          .filter((c) => c.provider !== "google")
          .map((c) => (
            <li
              key={c.provider}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{c.label}</span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      c.status === "error" ? "bg-amber-400"
                        : c.connected ? "bg-emerald-400" : "bg-white/20"
                    }`}
                  />
                  <span className="text-xs text-white/40">
                    {c.status === "error"
                      ? "Needs reconnect"
                      : c.connected ? "Connected" : c.supportsOAuth ? "Not connected" : "N/A"}
                  </span>
                </div>
                {c.accountLabel && (
                  <p className="mt-0.5 truncate text-xs text-white/45">{c.accountLabel}</p>
                )}
                {(c.status === "error" || c.statusDetail) && (
                  <p className="mt-0.5 text-xs text-amber-200/80">
                    {c.statusDetail ?? "Token refresh failed — reconnect to restore access."}
                  </p>
                )}
                {c.note && (
                  <p className="mt-1 text-xs text-white/35">{c.note}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {c.supportsOAuth && (!c.connected || c.status === "error") && CONNECT_HREF[c.provider] && (
                  <Link
                    href={CONNECT_HREF[c.provider]}
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15"
                  >
                    {c.status === "error" ? "Reconnect" : "Connect"}
                  </Link>
                )}
                {c.supportsOAuth && c.connected && c.status !== "error" && (
                  <button
                    type="button"
                    disabled={busy === c.provider}
                    onClick={() => void disconnect(c.provider)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                )}
                {c.provider === "icloud" && (
                  <Link
                    href="/dashboard/documents"
                    className="rounded-lg bg-[#CCFF00]/15 px-3 py-1.5 text-xs font-medium text-[#CCFF00]"
                  >
                    Upload / Email
                  </Link>
                )}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}
