"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/common/Toast";

interface Presence {
  website_url?: string | null;
  sitemap_url?: string | null;
  linkedin_url?: string | null;
  facebook_page_id?: string | null;
  instagram_business_id?: string | null;
  gbp_location_name?: string | null;
  indexnow_key?: string | null;
  llms_txt_blurb?: string | null;
  service_areas?: string[];
}

export default function PresenceSettingsPanel() {
  const { toast } = useToast();
  const [presence, setPresence] = useState<Presence>({});
  const [serviceAreas, setServiceAreas] = useState("");
  const [llmsPreview, setLlmsPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [gscHint, setGscHint] = useState<string | null>(null);
  const [gscRows, setGscRows] = useState<Array<{ query: string; clicks: number; impressions: number }>>([]);

  const load = useCallback(async () => {
    const [pRes, lRes, gRes] = await Promise.all([
      fetch("/api/presence"),
      fetch("/api/seo/llms-txt"),
      fetch("/api/seo/search-console/metrics"),
    ]);
    if (pRes.ok) {
      const d = await pRes.json() as { presence: Presence | null };
      const p = d.presence ?? {};
      setPresence(p);
      setServiceAreas(Array.isArray(p.service_areas) ? p.service_areas.join(", ") : "");
    }
    if (lRes.ok) {
      const d = await lRes.json() as { llms_txt?: string };
      setLlmsPreview(d.llms_txt ?? "");
    }
    if (gRes.ok) {
      const d = await gRes.json() as {
        connected?: boolean;
        hint?: string;
        rows?: Array<{ query: string; clicks: number; impressions: number }>;
      };
      setGscHint(d.connected ? null : (d.hint ?? "Connect Search Console"));
      setGscRows(d.rows ?? []);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/presence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...presence,
          service_areas: serviceAreas.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      toast({ title: "Presence settings saved", kind: "success" });
      await load();
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Presence, label: string, placeholder?: string) => (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
      {label}
      <input
        value={(presence[key] as string) ?? ""}
        onChange={(e) => setPresence((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={placeholder}
        className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/45">
        Link your website and profiles. SEO/AEO/LLMO tools are free (Search Console, IndexNow, schema, llms.txt).{" "}
        <Link href="/dashboard/settings/connections" className="text-[#CCFF00]/80 hover:underline">
          Manage OAuth connections
        </Link>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {field("website_url", "Website URL", "https://")}
        {field("sitemap_url", "Sitemap URL")}
        {field("linkedin_url", "LinkedIn company URL")}
        {field("facebook_page_id", "Facebook Page ID")}
        {field("instagram_business_id", "Instagram Business ID")}
        {field("gbp_location_name", "Google Business Profile location")}
        {field("indexnow_key", "IndexNow key")}
      </div>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
        Service areas (comma-separated)
        <input
          value={serviceAreas}
          onChange={(e) => setServiceAreas(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
        LLMO blurb
        <textarea
          value={presence.llms_txt_blurb ?? ""}
          onChange={(e) => setPresence((p) => ({ ...p, llms_txt_blurb: e.target.value }))}
          rows={3}
          className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-white"
        />
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-lg bg-[#CCFF00] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save presence"}
      </button>
      {llmsPreview && (
        <pre className="max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] text-white/70 whitespace-pre-wrap">
          {llmsPreview}
        </pre>
      )}

      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
          Search Console (28d)
        </p>
        {gscHint ? (
          <p className="text-xs text-amber-200/80">{gscHint}</p>
        ) : gscRows.length === 0 ? (
          <p className="text-xs text-white/40">No query rows yet.</p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-white/70">
            {gscRows.slice(0, 10).map((r) => (
              <li key={r.query} className="flex justify-between gap-2">
                <span className="truncate">{r.query}</span>
                <span className="shrink-0 font-mono text-white/45">
                  {r.clicks}c / {r.impressions}i
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
