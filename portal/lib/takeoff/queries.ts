"use client";

import { useQuery } from "@tanstack/react-query";
import { clientFetch } from "@/lib/http";

/** Static per-page data — invalidated only on explicit user action (recalibrate, vector refresh). */
const STATIC_STALE_MS = Infinity;

export interface SheetCalibration {
  scale_ratio: number | null;
  unit_type: string;
  page_space_scale_factor: number | null;
  status: "legacy_render_space" | "migrated" | "verified" | "needs_verification";
  verified: boolean;
}

export interface CadVectorRecord {
  layer: string;
  type?: "polyline" | "bbox" | "point";
  points: Array<[number, number]>;
  text_tag?: string;
}

export const takeoffQueryKeys = {
  calibration: (pageId: string) => ["takeoff", "calibration", pageId] as const,
  cadVectors: (pageId: string) => ["takeoff", "cad-vectors", pageId] as const,
};

export function useSheetCalibration(pageId: string) {
  return useQuery({
    queryKey: takeoffQueryKeys.calibration(pageId),
    queryFn: async (): Promise<SheetCalibration | null> => {
      const res = await clientFetch(
        `/api/takeoff/canvas/calibration?page_id=${encodeURIComponent(pageId)}`,
      );
      if (!res.ok) throw new Error(`calibration ${res.status}`);
      const data = (await res.json()) as { calibration: SheetCalibration | null };
      return data.calibration;
    },
    staleTime: STATIC_STALE_MS,
  });
}

export function useCadVectorMetadata(pageId: string, enabled = true) {
  return useQuery({
    queryKey: takeoffQueryKeys.cadVectors(pageId),
    queryFn: async (): Promise<CadVectorRecord[]> => {
      const res = await clientFetch(
        `/api/takeoff/canvas/vectors?page_id=${encodeURIComponent(pageId)}`,
      );
      if (!res.ok) throw new Error(`vectors ${res.status}`);
      const data = (await res.json()) as { vectors?: CadVectorRecord[] };
      return Array.isArray(data.vectors) ? data.vectors : [];
    },
    staleTime: STATIC_STALE_MS,
    enabled: enabled && !!pageId,
  });
}
