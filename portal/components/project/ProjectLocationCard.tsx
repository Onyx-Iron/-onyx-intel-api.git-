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

interface Props {
  projectId: string;
  initial: LocationData;
}

// Minimal Google Places types — avoid a hard dep on @types/google.maps.
type PlacesAutocomplete = {
  addListener: (event: string, cb: () => void) => void;
  getPlace: () => {
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    geometry?: { location?: { lat: () => number; lng: () => number } };
    formatted_address?: string;
  };
};

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: { types?: string[]; componentRestrictions?: { country?: string | string[] } },
          ) => PlacesAutocomplete;
        };
      };
    };
  }
}

export default function ProjectLocationCard({ projectId, initial }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<LocationData>(initial);
  const [draft, setDraft] = useState<LocationData>(initial);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<PlacesAutocomplete | null>(null);

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
              : "Manual entry only — Google autocomplete not loaded."}
          </p>
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
