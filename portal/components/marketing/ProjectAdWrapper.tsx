"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}

interface ProjectImage {
  name: string;
  path: string;
  url: string;
}

export default function ProjectAdWrapper({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [loadingImages, setLoadingImages] = useState(false);
  const [platform, setPlatform] = useState<"google_ads" | "meta">("google_ads");
  const [campaignName, setCampaignName] = useState("");
  const [copy, setCopy] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [budgetDaily, setBudgetDaily] = useState(25);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { projects?: Project[] }) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!projectId) {
        setImages([]);
        setLoadingImages(false);
        setSelectedImages(new Set());
        return;
      }
      setLoadingImages(true);
      setSelectedImages(new Set());
      fetch(`/api/marketing/project-images?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { images?: ProjectImage[] }) => setImages(d.images ?? []))
        .catch(() => setImages([]))
        .finally(() => setLoadingImages(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projectId]);

  const project = projects.find((p) => p.id === projectId);

  const toggleImage = (path: string) => setSelectedImages((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  async function dispatch() {
    if (!project) return;
    if (project.latitude == null || project.longitude == null) {
      setResult({ ok: false, message: "This project has no coordinates set - add a location before launching a geo-targeted campaign." });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const selectedUrls = images.filter((i) => selectedImages.has(i.path)).map((i) => i.url);
      const res = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: project.id,
          platform,
          campaign_name: campaignName || `${project.name} - Local Lead Gen`,
          budget_daily: budgetDaily,
          creative: { image_urls: selectedUrls, copy, radius_miles: radiusMiles, lat: project.latitude, lng: project.longitude },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? `Failed (${res.status})` });
        return;
      }
      if (data.launch_error) setResult({ ok: false, message: `Saved as draft - ${data.launch_error}` });
      else {
        setResult({ ok: true, message: `Campaign launched on ${platform === "google_ads" ? "Google Ads" : "Meta"}.` });
        setTimeout(onDone, 1200);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0E0F12] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white">Launch Campaign from Project</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">×</button>
        </div>

        {result && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${result.ok ? "border border-[#CCFF00]/30 bg-[#CCFF00]/10 text-[#CCFF00]" : "border border-amber-500/30 bg-amber-900/10 text-amber-400"}`}>
            {result.message}
          </div>
        )}

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-white/40">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none">
            <option value="">Select a project...</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        {projectId && (
          <div className="mb-3">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Progress Photos ({selectedImages.size} selected)</span>
            {loadingImages ? (
              <div className="py-4 text-center text-xs text-white/40">Loading project photos...</div>
            ) : images.length === 0 ? (
              <div className="py-4 text-center text-xs text-white/40">No project photos found yet. Add a few progress photos and then launch the campaign again.</div>
            ) : (
              <div className="mt-1 grid max-h-40 grid-cols-4 gap-2 overflow-y-auto">
                {images.map((img) => (
                  <button key={img.path} type="button" onClick={() => toggleImage(img.path)} className={`relative aspect-square overflow-hidden rounded border-2 ${selectedImages.has(img.path) ? "border-[#CCFF00]" : "border-white/10"}`}>
                    <Image src={img.url} alt={img.name} fill unoptimized className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-white/40">Campaign Name</span>
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder={project ? `${project.name} - Local Lead Gen` : ""} className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none" />
        </label>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-white/40">Marketing Copy</span>
          <textarea value={copy} onChange={(e) => setCopy(e.target.value)} rows={3} placeholder="Just finished a beautiful driveway pour in your neighborhood - get a free estimate!" className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none" />
        </label>

        <div className="mb-3 grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Platform</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as "google_ads" | "meta")} className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none">
              <option value="google_ads">Google Ads</option>
              <option value="meta">Meta</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Radius (mi)</span>
            <input type="number" min={1} step={1} value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value))} className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-widest text-white/40">Daily Budget ($)</span>
            <input type="number" min={1} step={1} value={budgetDaily} onChange={(e) => setBudgetDaily(Number(e.target.value))} className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white focus:border-[#CCFF00] focus:outline-none" />
          </label>
        </div>

        {project && (project.latitude == null || project.longitude == null) && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-400">
            This project has no coordinates set. Geo-targeted campaigns will stay blocked until a location is added.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white">Cancel</button>
          <button type="button" onClick={dispatch} disabled={!projectId || submitting} className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-4 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-40">
            {submitting ? "Launching..." : "Dispatch Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
