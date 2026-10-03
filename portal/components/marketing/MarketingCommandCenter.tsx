"use client";

import { useCallback, useEffect, useState } from "react";
import ProjectAdWrapper from "./ProjectAdWrapper";
import PresenceSettingsPanel from "./PresenceSettingsPanel";
import { useToast } from "@/components/common/Toast";

type MarketingTab = "profiles" | "organic" | "seo" | "paid";

interface Campaign {
  id: string;
  platform: "google_ads" | "meta";
  campaign_name: string;
  budget_daily: number;
  clicks: number;
  spend_total: number;
  status: string;
  project_id: string | null;
}

interface Lead {
  id: string;
  campaign_id: string | null;
  source: string | null;
}

const PLATFORM_LABEL: Record<string, string> = { google_ads: "Google Ads", meta: "Meta" };
const PLATFORM_COLOR: Record<string, string> = { google_ads: "#4285F4", meta: "#0668E1" };

export default function MarketingCommandCenter() {
  const [tab, setTab] = useState<MarketingTab>("profiles");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [platformsConfigured, setPlatformsConfigured] = useState<{ google_ads: boolean; meta: boolean }>({ google_ads: false, meta: false });
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [organicCopy, setOrganicCopy] = useState("");
  const [publishing, setPublishing] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, lRes] = await Promise.all([
        fetch("/api/marketing/campaigns", { cache: "no-store" }),
        fetch("/api/marketing/leads", { cache: "no-store" }),
      ]);
      if (cRes.ok) {
        const d = await cRes.json() as { campaigns: Campaign[]; platforms: { google_ads: boolean; meta: boolean } };
        setCampaigns(d.campaigns ?? []);
        setPlatformsConfigured(d.platforms);
      }
      if (lRes.ok) {
        const d = await lRes.json() as { leads: Lead[] };
        setLeads(d.leads ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const totalSpend = campaigns.reduce((s, c) => s + Number(c.spend_total || 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + Number(c.clicks || 0), 0);
  const totalLeads = leads.length;
  const activeCampaigns = campaigns.filter((c) => c.status === "active" || c.status === "launching").length;
  const cpa = totalLeads > 0 ? totalSpend / totalLeads : null;
  const maxFunnel = Math.max(activeCampaigns, totalClicks, totalLeads, 1);
  const spendByPlatform = (["google_ads", "meta"] as const).map((p) => ({
    platform: p,
    spend: campaigns.filter((c) => c.platform === p).reduce((s, c) => s + Number(c.spend_total || 0), 0),
  }));
  const maxSpend = Math.max(...spendByPlatform.map((p) => p.spend), 1);

  const publishOrganic = async () => {
    if (!organicCopy.trim()) return;
    if (!confirm("Publish this organic post to selected channels?")) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/presence/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          copy: organicCopy,
          channels: ["linkedin_share", "meta"],
        }),
      });
      const data = await res.json() as { error?: string; linkedin_share_url?: string };
      if (!res.ok) throw new Error(data.error ?? "Publish failed");
      if (data.linkedin_share_url) window.open(data.linkedin_share_url, "_blank");
      toast({ title: "Post recorded", kind: "success" });
      setOrganicCopy("");
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold text-white uppercase tracking-widest">Marketing Command Center</h2>
          <p className="text-[11px] text-gray-500">Profiles, organic presence, free SEO/LLMO, and optional paid ads</p>
        </div>
        {tab === "paid" && (
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85"
          >
            Launch Campaign from Project
          </button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {([
          ["profiles", "Profiles"],
          ["organic", "Organic"],
          ["seo", "SEO / LLMO"],
          ["paid", "Paid ads"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest ${
              tab === id ? "bg-[#CCFF00] text-black" : "bg-white/5 text-white/50 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "profiles" && <PresenceSettingsPanel />}

      {tab === "organic" && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-[#0E0F12] p-4">
          <p className="text-xs text-white/45">
            Publish wins to Meta/GBP when connected. LinkedIn uses share-intent until org posting is approved.
          </p>
          <textarea
            value={organicCopy}
            onChange={(e) => setOrganicCopy(e.target.value)}
            rows={4}
            placeholder="We just wrapped Highland Elementary — on time and under budget…"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            disabled={publishing || !organicCopy.trim()}
            onClick={() => void publishOrganic()}
            className="rounded-lg bg-[#CCFF00] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {publishing ? "Publishing…" : "Approve & publish"}
          </button>
        </div>
      )}

      {tab === "seo" && <PresenceSettingsPanel />}

      {tab === "paid" && (
        <>
      {!platformsConfigured.google_ads && !platformsConfigured.meta && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-900/10 px-4 py-2 text-[11px] text-amber-400">
          Paid ads require ad budget. Campaigns save as drafts until Google Ads / Meta API credentials are configured.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Spend" value={`$${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <KpiCard label="Total Clicks" value={totalClicks.toLocaleString()} />
        <KpiCard label="Leads Captured" value={totalLeads.toLocaleString()} accent />
        <KpiCard label="Cost Per Acquisition" value={cpa != null ? `$${cpa.toFixed(2)}` : "—"} />
      </div>

      {/* Conversion funnel */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4 mb-6">
        <div className="mb-3 text-[10px] uppercase tracking-widest font-mono text-white/40">Conversion Funnel</div>
        <div className="space-y-2">
          <FunnelBar label="Active Campaigns" value={activeCampaigns} max={maxFunnel} color="#CCFF00" />
          <FunnelBar label="Clicks" value={totalClicks} max={maxFunnel} color="#00D2FF" />
          <FunnelBar label="Leads" value={totalLeads} max={maxFunnel} color="#f97316" />
        </div>
      </div>

      {/* Spend by platform */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4 mb-6">
        <div className="mb-3 text-[10px] uppercase tracking-widest font-mono text-white/40">Spend by Platform</div>
        <div className="space-y-2">
          {spendByPlatform.map((p) => (
            <div key={p.platform} className="flex items-center gap-3">
              <span className="w-20 text-[10px] uppercase tracking-widest text-white/50">{PLATFORM_LABEL[p.platform]}</span>
              <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(p.spend / maxSpend) * 100}%`, backgroundColor: PLATFORM_COLOR[p.platform] }} />
              </div>
              <span className="w-16 text-right text-xs font-mono text-white/70">${p.spend.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign table */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] overflow-hidden">
        <div className="border-b border-white/10 px-4 py-2 text-[10px] uppercase tracking-widest font-mono text-white/40">Campaigns</div>
        {loading ? (
          <div className="p-8 text-center text-xs text-white/40">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-xs text-white/40">No campaigns yet. Launch one from a project&apos;s progress photos.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-widest text-white/40 border-b border-white/5">
                <th className="px-4 py-2">Campaign</th>
                <th className="px-4 py-2">Platform</th>
                <th className="px-4 py-2 text-right">Daily Budget</th>
                <th className="px-4 py-2 text-right">Spend</th>
                <th className="px-4 py-2 text-right">Clicks</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-white/5">
                  <td className="px-4 py-2 text-white/80">{c.campaign_name}</td>
                  <td className="px-4 py-2" style={{ color: PLATFORM_COLOR[c.platform] }}>{PLATFORM_LABEL[c.platform]}</td>
                  <td className="px-4 py-2 text-right font-mono text-white/60">${Number(c.budget_daily).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-white/60">${Number(c.spend_total).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-white/60">{c.clicks}</td>
                  <td className="px-4 py-2 uppercase text-[10px] text-white/50">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {wizardOpen && (
        <ProjectAdWrapper onClose={() => setWizardOpen(false)} onDone={async () => { setWizardOpen(false); await load(); }} />
      )}
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] px-4 py-3">
      <p className={`text-xl font-black ${accent ? "text-[#CCFF00]" : "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-gray-600 mt-0.5">{label}</p>
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max((value / max) * 100, value > 0 ? 4 : 0);
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-[10px] uppercase tracking-widest text-white/50">{label}</span>
      <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full flex items-center justify-end pr-2" style={{ width: `${pct}%`, backgroundColor: color }}>
          <span className="text-[10px] font-mono text-black font-bold">{value}</span>
        </div>
      </div>
    </div>
  );
}
