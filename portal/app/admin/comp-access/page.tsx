"use client";

import { useEffect, useState, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import PageHero from "@/components/layout/PageHero";

const ADMIN_EMAIL = "justinatteberry@onyx-iron.com";

interface CompTenant {
  id: string;
  name: string | null;
  clerk_org_id: string | null;
  comp_until: string | null;
}

interface ListResponse {
  tenants: CompTenant[];
}

export default function CompAccessAdminPage() {
  const { isLoaded, user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const isAuthorized = email === ADMIN_EMAIL;

  const [search, setSearch] = useState("");
  const [days, setDays] = useState("30");
  const [forever, setForever] = useState(false);
  const [comped, setComped] = useState<CompTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthorized) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/comp-access", { cache: "no-store" });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = (await res.json()) as ListResponse;
      setComped(json.tenants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (isLoaded && isAuthorized) {
      void refresh();
    }
  }, [isLoaded, isAuthorized, refresh]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06070A] text-white/45">
        Loading…
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06070A]">
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
            403
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
            Forbidden
          </h1>
          <p className="mt-2 text-sm text-white/45">
            You are not authorized to access this page.
          </p>
        </div>
      </div>
    );
  }

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const query = search.trim();
    if (!query) {
      setError("Enter a tenant name or org slug");
      return;
    }

    const compUntil = forever
      ? null
      : (() => {
          const n = parseInt(days, 10);
          if (!Number.isFinite(n) || n <= 0) return null;
          const d = new Date();
          d.setDate(d.getDate() + n);
          return d.toISOString();
        })();

    if (!forever && !compUntil) {
      setError("Enter a valid number of days");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/comp-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_query: query,
          comp_until: forever ? "forever" : compUntil,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed (${res.status})`);
      }
      setMessage(forever ? "Comp access granted (forever)" : `Comp access granted for ${days} days`);
      setSearch("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (tenantId: string) => {
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/comp-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed (${res.status})`);
      }
      setMessage("Comp access revoked");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="min-h-screen bg-[#06070A]">
      <PageHero
        eyebrow="Admin"
        title="Comp Access"
        description="Grant courtesy access to tenants. Justin only."
      />

      <div className="space-y-6 px-4 py-8 lg:px-10">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-4 py-3 text-xs text-[#CCFF00]">
            {message}
          </div>
        )}

        {/* Grant form */}
        <form
          onSubmit={handleGrant}
          className="rounded-2xl border border-white/8 bg-[#0E0F12] p-6"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
            Grant Comp Access
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-white/45">
                Tenant name or org slug
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-lg border border-white/10 bg-[#06070A] px-3 text-sm text-white placeholder-white/30 focus:border-[#CCFF00]/50 focus:outline-none"
                placeholder="e.g. acme-co"
              />
            </label>

            <div>
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-white/45">
                Duration
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  disabled={forever}
                  className="h-10 w-24 rounded-lg border border-white/10 bg-[#06070A] px-3 text-sm text-white focus:border-[#CCFF00]/50 focus:outline-none disabled:opacity-40"
                />
                <span className="text-xs text-white/60">days</span>
                <label className="ml-4 inline-flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={forever}
                    onChange={(e) => setForever(e.target.checked)}
                    className="h-4 w-4 accent-[#CCFF00]"
                  />
                  Forever
                </label>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {submitting ? "Granting…" : "Grant Comp Access"}
            </button>
          </div>
        </form>

        {/* List */}
        <div className="rounded-2xl border border-white/8 bg-[#0E0F12]">
          <div className="border-b border-white/8 px-6 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              Currently Comped Tenants
            </p>
          </div>
          {loading ? (
            <p className="px-6 py-8 text-center text-sm text-white/45">
              Loading…
            </p>
          ) : comped.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-white/45">
              No tenants currently have comp access.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] font-bold uppercase tracking-widest text-white/45">
                <tr className="border-b border-white/8">
                  <th className="px-6 py-3">Tenant</th>
                  <th className="px-6 py-3">Org Slug</th>
                  <th className="px-6 py-3">Comp Until</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {comped.map((t) => (
                  <tr key={t.id} className="border-b border-white/5 text-white">
                    <td className="px-6 py-3">{t.name ?? "—"}</td>
                    <td className="px-6 py-3 text-white/60">
                      {t.clerk_org_id ?? "—"}
                    </td>
                    <td className="px-6 py-3 text-white/60">
                      {t.comp_until
                        ? new Date(t.comp_until).toLocaleDateString()
                        : "Forever"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(t.id)}
                        className="text-[11px] font-bold uppercase tracking-widest text-red-300 hover:text-red-200"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
