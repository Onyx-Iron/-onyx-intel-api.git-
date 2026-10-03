"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Pencil, X } from "lucide-react";
import { useToast } from "@/components/common/Toast";

interface LocationData {
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface WeatherDay {
  date: string;
  precipMm: number;
  tempMaxC: number;
  tempMinC: number;
  delayRisk: boolean;
}

interface Props {
  projectId: string;
  initial: LocationData;
}

import type { GooglePlacesAutocomplete } from "@/lib/google/window";

export default function ProjectLocationCard({ projectId, initial }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<LocationData>(initial);
  const [draft, setDraft] = useState<LocationData>(initial);
  const [nominatimQ, setNominatimQ] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [forecast, setForecast] = useState<WeatherDay[]>([]);
  const [delayDays, setDelayDays] = useState(0);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<GooglePlacesAutocomplete | null>(null);

  useEffect(() => {
    const lat = data.latitude;
    const lon = data.longitude;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/site/weather?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&days=7`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const body = await res.json() as { forecast?: WeatherDay[]; delay_days?: number };
        if (!cancelled) {
          setForecast(body.forecast ?? []);
          setDelayDays(body.delay_days ?? 0);
        }
      } catch {
        /* free weather is best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [data.latitude, data.longitude]);

  async function geocodeWithNominatim() {
    const q = nominatimQ.trim() || [draft.city, draft.state, draft.zip_code].filter(Boolean).join(", ");
    if (!q) {
      toast({ title: "Enter an address to geocode", kind: "error" });
      return;
    }
    setGeocoding(true);
    try {
      const res = await fetch(`/api/site/geocode?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const body = await res.json() as {
        error?: string;
        result?: { lat: number; lon: number; displayName?: string } | null;
      };
      if (!res.ok || !body.result) throw new Error(body.error ?? "Geocode failed");
      const parts = (body.result.displayName ?? "").split(",").map((p) => p.trim());
      // Nominatim displayName is typically "…, City, County, State, ZIP, Country"
      const cityGuess = parts.length >= 4 ? parts[parts.length - 5] ?? parts[0] : parts[0];
      const stateGuess = parts.length >= 3 ? parts[parts.length - 3] : undefined;
      const zipGuess = parts.find((p) => /^\d{5}(-\d{4})?$/.test(p));
      setDraft((d) => ({
        ...d,
        latitude: body.result!.lat,
        longitude: body.result!.lon,
        city: cityGuess || d.city,
        state: stateGuess || d.state,
        zip_code: zipGuess ?? d.zip_code,
      }));
      toast({ title: "Coordinates filled via OpenStreetMap Nominatim", kind: "success" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Geocode failed", kind: "error" });
    } finally {
      setGeocoding(false);
    }
  }

  // Attach Google Places Autocomplete when editing opens, if available.
  useEffect(() => {
    if (!editing) return;
    const input = addressInputRef.current;
    if (!input) return;
    const places = window.google?.maps?.places;
    if (!places) return;

    try {
      const ac = new places.Autocomplete(input, {
        types: ["address"],
        componentRestrictions: { country: "us" },
      });
      autocompleteRef.current = ac;
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const comps = place.address_components ?? [];
        const get = (type: string) =>
          comps.find((c) => c.types.includes(type))?.short_name ?? null;
        const cityComp =
          comps.find((c) => c.types.includes("locality"))?.long_name ??
          comps.find((c) => c.types.includes("sublocality"))?.long_name ??
          null;
        const stateComp = get("administrative_area_level_1");
        const zipComp = get("postal_code");
        const lat = place.geometry?.location?.lat?.();
        const lng = place.geometry?.location?.lng?.();
        setDraft((d) => ({
          ...d,
          city: cityComp ?? d.city,
          state: stateComp ?? d.state,
          zip_code: zipComp ?? d.zip_code,
          latitude: typeof lat === "number" ? lat : d.latitude,
          longitude: typeof lng === "number" ? lng : d.longitude,
        }));
      });
    } catch {
      // Silently ignore — fall back to manual entry.
    }
  }, [editing]);

  const hasLocation = !!(data.city || data.state || data.zip_code);
  const locationLine = [data.city, data.state].filter(Boolean).join(", ");

  function startEdit() {
    setDraft(data);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(data);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        city: draft.city || null,
        state: draft.state || null,
        zip_code: draft.zip_code || null,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
      };
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(draft);
      setEditing(false);
      toast({ title: "Location updated", kind: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ title: msg, kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof LocationData>(key: K, value: LocationData[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2">
          <MapPin className="h-3 w-3 text-white/40" aria-hidden />
          {hasLocation ? (
            <span className="text-xs text-white/55">
              {locationLine}
              {data.zip_code && <span className="ml-1 text-white/40">{data.zip_code}</span>}
            </span>
          ) : (
            <span className="text-xs text-white/40">No location set</span>
          )}
          <button
            type="button"
            onClick={startEdit}
            className="rounded p-1 text-white/40 transition hover:bg-white/5 hover:text-white"
            aria-label="Edit project location"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
        {forecast.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-white/40">
              Site weather (Open-Meteo){delayDays > 0 ? ` · ${delayDays} delay-risk day${delayDays === 1 ? "" : "s"}` : ""}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {forecast.slice(0, 5).map((d) => (
                <span
                  key={d.date}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    d.delayRisk ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-white/55"
                  }`}
                  title={`${d.precipMm.toFixed(1)} mm precip`}
                >
                  {d.date.slice(5)} {Math.round(d.tempMaxC)}°/{Math.round(d.tempMinC)}°
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={save}
      className="mt-2 w-full max-w-2xl rounded-xl border border-white/10 bg-[#0E0F12] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">
          Edit Project Location
        </p>
        <button
          type="button"
          onClick={cancel}
          className="rounded p-1 text-white/40 hover:bg-white/5 hover:text-white"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
            Address / Search
          </label>
          <input
            ref={addressInputRef}
            type="text"
            placeholder="Start typing an address…"
            className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            autoComplete="off"
          />
          <p className="mt-1 text-[10px] text-white/40">
            {typeof window !== "undefined" && window.google?.maps?.places
              ? "Google autocomplete enabled — selecting a result will fill the fields below."
              : "Manual entry only — Google autocomplete not loaded. Use free Nominatim geocode below."}
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={nominatimQ}
              onChange={(e) => setNominatimQ(e.target.value)}
              placeholder="Free geocode (city, address…)"
              className="h-9 min-w-0 flex-1 rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={geocoding}
              onClick={() => void geocodeWithNominatim()}
              className="shrink-0 rounded border border-white/15 px-3 text-[11px] font-bold uppercase tracking-widest text-white/80 hover:bg-white/5 disabled:opacity-50"
            >
              {geocoding ? "…" : "Nominatim"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
              City
            </label>
            <input
              value={draft.city ?? ""}
              onChange={(e) => setField("city", e.target.value)}
              className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
              State
            </label>
            <input
              value={draft.state ?? ""}
              onChange={(e) => setField("state", e.target.value)}
              maxLength={32}
              className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
              ZIP
            </label>
            <input
              value={draft.zip_code ?? ""}
              onChange={(e) => setField("zip_code", e.target.value)}
              maxLength={10}
              className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
              Latitude (optional)
            </label>
            <input
              type="number"
              step="any"
              value={draft.latitude ?? ""}
              onChange={(e) =>
                setField("latitude", e.target.value === "" ? null : Number(e.target.value))
              }
              className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/45">
              Longitude (optional)
            </label>
            <input
              type="number"
              step="any"
              value={draft.longitude ?? ""}
              onChange={(e) =>
                setField("longitude", e.target.value === "" ? null : Number(e.target.value))
              }
              className="h-9 w-full rounded border border-white/10 bg-[#08090C] px-3 text-sm text-white focus:border-[#CCFF00]/40 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="inline-flex h-8 items-center rounded-full border border-white/15 px-3 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-8 items-center rounded-full bg-[#CCFF00] px-3 text-[11px] font-bold uppercase tracking-widest text-black hover:opacity-85 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
