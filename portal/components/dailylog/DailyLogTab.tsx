"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Plus, Camera, X, Cloud, Users } from "lucide-react";

import { useToast } from "@/components/common/Toast";
import { useConfirm } from "@/components/common/ConfirmDialog";
import EmptyState from "@/components/common/EmptyState";

interface Photo { path: string; url: string | null; }

interface DailyLog {
  id: string;
  log_date: string;
  weather: string | null;
  temperature: string | null;
  crew_count: number | null;
  work_performed: string | null;
  notes: string | null;
  photos: Photo[];
  created_at: string;
}

interface FormState {
  log_date: string;
  weather: string;
  temperature: string;
  crew_count: string;
  work_performed: string;
  notes: string;
  client_visible: boolean;
}

const today = () => new Date().toISOString().split("T")[0];

const EMPTY_FORM: FormState = {
  log_date: today(), weather: "", temperature: "", crew_count: "", work_performed: "", notes: "", client_visible: false,
};

const WEATHER_OPTS = ["Clear", "Partly Cloudy", "Overcast", "Rain", "Snow", "Windy", "Hot", "Cold"];

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function ProductionEditor({ projectId, logId }: { projectId: string; logId: string }) {
  const { toast } = useToast();
  const [headcount, setHeadcount] = useState("");
  const [hours, setHours] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [delayHours, setDelayHours] = useState("");
  const [equipment, setEquipment] = useState("");
  const [equipmentHours, setEquipmentHours] = useState("");
  const [delivery, setDelivery] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");

  const save = async () => {
    const res = await fetch("/api/daily-production", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        daily_log_id: logId,
        manpower: headcount ? [{ company_name: "Crew", headcount: Number(headcount), hours: Number(hours) || 0 }] : [],
        delays: delayReason ? [{ reason_code: delayReason, hours: Number(delayHours) || 0 }] : [],
        equipment: equipment ? [{ name: equipment, hours: Number(equipmentHours) || 0 }] : [],
        deliveries: delivery ? [{ note: delivery }] : [],
        quantities: quantity ? [{ quantity: Number(quantity), unit: unit || null }] : [],
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: String((data as { error?: string }).error ?? "Could not save production"), kind: "error" });
      return;
    }
    toast({ title: String("Production saved on this log"), kind: "success" });
  };

  const field = "bg-[#0A0A0B] border border-white/10 rounded px-2 py-1 text-[11px] text-white";
  return (
    <div className="mt-3 grid gap-2 border-t border-white/5 pt-3 md:grid-cols-5">
      <input className={field} placeholder="Headcount" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
      <input className={field} placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
      <input className={field} placeholder="Delay reason" value={delayReason} onChange={(e) => setDelayReason(e.target.value)} />
      <input className={field} placeholder="Delay hours" value={delayHours} onChange={(e) => setDelayHours(e.target.value)} />
      <input className={field} placeholder="Equipment" value={equipment} onChange={(e) => setEquipment(e.target.value)} />
      <input className={field} placeholder="Equip. hours" value={equipmentHours} onChange={(e) => setEquipmentHours(e.target.value)} />
      <input className={field} placeholder="Delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
      <input className={field} placeholder="Qty installed" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <input className={field} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
      <button type="button" onClick={() => { void save(); }} className="text-[10px] uppercase tracking-widest text-[#CCFF00]">Save production</button>
    </div>
  );
}

export default function DailyLogTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pendingPhotos, setPendingPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/daily-logs?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: { logs?: DailyLog[] }) => { setLogs(d.logs ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setForm(EMPTY_FORM); setPendingPhotos([]); setShowForm(true); };
  const cancel = () => { setShowForm(false); setPendingPhotos([]); setForm(EMPTY_FORM); };

  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/daily-logs/photo?project_id=${encodeURIComponent(projectId)}`, { method: "POST", body: fd });
        const d = await res.json() as { path?: string; url?: string; error?: string };
        if (res.ok && d.path) setPendingPhotos((prev) => [...prev, { path: d.path!, url: d.url ?? null }]);
        else toast({ title: String(`Photo upload failed: ${d.error ?? res.status}`), kind: "error" });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePending = (path: string) => setPendingPhotos((prev) => prev.filter((p) => p.path !== path));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || uploading) return; // Fix: prevent double-submit / submit-during-upload
    // Fix: coerce parseInt safely — empty/invalid strings produced NaN sent to API
    const crewNum = form.crew_count.trim() ? Number.parseInt(form.crew_count, 10) : NaN;
    setSubmitting(true);
    try {
      const res = await fetch("/api/daily-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          log_date: form.log_date || today(),
          weather: form.weather || null,
          temperature: form.temperature || null,
          crew_count: Number.isFinite(crewNum) ? crewNum : null,
          work_performed: form.work_performed || null,
          notes: form.notes || null,
          client_visible: form.client_visible,
          photo_urls: pendingPhotos.map((p) => p.path),
        }),
      });
      if (!res.ok) {
        // Fix: was closing form silently on failure
        const d = await res.json().catch(() => ({}));
        toast({ title: String(`Save failed: ${(d as { error?: string })?.error ?? res.status}`), kind: "error" });
        return;
      }
      cancel();
      load();
    } catch {
      toast({ title: String("Save failed — network error."), kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteLog = async (id: string) => {
    if (!(await confirm({ title: String("Delete this daily log and its photos?"), destructive: true }))) return;
    // Fix: optimistic-delete now rolls back on non-OK response too, not only network errors
    const snapshot = logs;
    setLogs((prev) => prev.filter((l) => l.id !== id));
    try {
      const res = await fetch(`/api/daily-logs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setLogs(snapshot);
        toast({ title: String(`Delete failed (${res.status}).`), kind: "error" });
      }
    } catch {
      setLogs(snapshot);
      toast({ title: String("Delete failed — network error."), kind: "error" });
    }
  };

  const inputCls = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#CCFF00]/40 transition-colors";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={12} className="text-[#CCFF00]" />
          <span className="text-[11px] uppercase tracking-widest text-gray-400">Daily Logs</span>
          {logs.length > 0 && <span className="text-[9px] text-gray-700 font-mono">{logs.length}</span>}
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors">
          <Plus size={11} /> New Log
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">New Daily Log</p>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Date</label>
                <input type="date" value={form.log_date} onChange={(e) => setForm((f) => ({ ...f, log_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Weather</label>
                <input list="weather-opts" value={form.weather} onChange={(e) => setForm((f) => ({ ...f, weather: e.target.value }))} className={inputCls} placeholder="Clear" />
                <datalist id="weather-opts">{WEATHER_OPTS.map((w) => <option key={w} value={w} />)}</datalist>
                <button
                  type="button"
                  className="mt-1 text-[10px] uppercase tracking-widest text-[#00D2FF]"
                  onClick={async () => {
                    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/weather`);
                    const data = await res.json().catch(() => ({})) as { weather?: string | null; temperature?: string | null };
                    if (!data.weather && !data.temperature) {
                      toast({ title: String("No site weather. Set the project coordinates, or type it in."), kind: "error" });
                      return;
                    }
                    setForm((current) => ({
                      ...current,
                      weather: data.weather ?? current.weather,
                      temperature: data.temperature ?? current.temperature,
                    }));
                  }}
                >
                  Fill from site
                </button>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Temp (Â°F)</label>
                <input value={form.temperature} onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))} className={inputCls} placeholder="72" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Crew Size</label>
                <input type="number" min="0" value={form.crew_count} onChange={(e) => setForm((f) => ({ ...f, crew_count: e.target.value }))} className={`${inputCls} font-mono`} placeholder="0" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Work Performed</label>
              <textarea value={form.work_performed} onChange={(e) => setForm((f) => ({ ...f, work_performed: e.target.value }))} rows={3} className={inputCls} placeholder="Describe work completed todayâ€¦" />
            </div>
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input type="checkbox" checked={form.client_visible} onChange={(e) => setForm((f) => ({ ...f, client_visible: e.target.checked }))} />
              Visible to the client on this project
            </label>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes / Issues</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className={inputCls} placeholder="Delays, deliveries, safety, visitorsâ€¦" />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Photos</label>
              <div className="flex flex-wrap gap-2">
                {pendingPhotos.map((p) => (
                  <div key={p.path} className="relative w-20 h-20 rounded-lg overflow-hidden border border-white/10">
                    {p.url
                      ? <img src={p.url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-white/5" />}
                    <button type="button" aria-label="Remove photo" onClick={() => removePending(p.path)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-white hover:bg-[#E50914] focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40">
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="w-20 h-20 rounded-lg border border-dashed border-white/15 flex flex-col items-center justify-center gap-1 text-gray-500 hover:border-[#CCFF00]/40 hover:text-[#CCFF00] transition-colors disabled:opacity-50">
                  <Camera size={16} />
                  <span className="text-[8px] uppercase tracking-widest">{uploading ? "â€¦" : "Add"}</span>
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => handlePhotos(e.target.files)} />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={submitting || uploading}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50">
                {submitting ? "Savingâ€¦" : "Save Log"}
              </button>
              <button type="button" onClick={cancel} className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Log list */}
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-xl border border-white/10 bg-[#0E0F12] animate-pulse" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-6 h-6" />}
          title="No daily logs yet"
          description="Log today's work, weather, crew, and progress to keep records straight."
          actionLabel="New Log"
          onAction={openAdd}
        />
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border border-white/10 bg-[#0E0F12] p-5 hover:border-white/20 transition-colors group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-white text-sm font-bold">{fmtDate(log.log_date)}</span>
                  {log.weather && <span className="flex items-center gap-1 text-[10px] text-[#00D2FF]"><Cloud size={10} />{log.weather}{log.temperature ? ` Â· ${log.temperature}Â°` : ""}</span>}
                  {log.crew_count != null && <span className="flex items-center gap-1 text-[10px] text-gray-400"><Users size={10} />{log.crew_count} crew</span>}
                </div>
                <button aria-label="Delete daily log" onClick={() => deleteLog(log.id)} className="min-h-[40px] text-gray-600 hover:text-[#E50914] opacity-0 group-hover:opacity-100 transition-all">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
              {log.work_performed && <p className="text-gray-300 text-xs mt-2 whitespace-pre-wrap">{log.work_performed}</p>}
              {log.notes && <p className="text-gray-500 text-[11px] mt-1.5 whitespace-pre-wrap">{log.notes}</p>}
              <ProductionEditor projectId={projectId} logId={log.id} />
              {log.photos.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {log.photos.map((p, i) => p.url && (
                    <a key={i} href={p.url} target="_blank" rel="noopener" className="w-20 h-20 rounded-lg overflow-hidden border border-white/10 hover:border-[#CCFF00]/40 transition-colors">
                      <img src={p.url} alt="" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
