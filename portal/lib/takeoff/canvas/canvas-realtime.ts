/** Shared types + pure helpers for SheetCanvas Realtime collaboration. */

export type CanvasPeer = {
  key: string;
  name: string;
  color: string;
  x?: number;
  y?: number;
  updatedAt?: number;
};

export type CanvasCollabKind =
  | "shape_upsert"
  | "shape_remove"
  | "utility_upsert"
  | "utility_remove"
  | "topo_upsert"
  | "topo_remove"
  | "area_upsert"
  | "area_remove"
  | "cursor";

export type CanvasCollabEvent = {
  kind: CanvasCollabKind;
  senderId: string;
  /** Opaque JSON payload — Shape / UtilityRun / etc. or { key } / cursor pts */
  payload: unknown;
  ts: number;
};

export function canvasChannelName(projectId: string, pageId: string): string {
  return `canvas:${projectId}:${pageId}`;
}

const PEER_COLORS = [
  "#CCFF00",
  "#00D2FF",
  "#f97316",
  "#a855f7",
  "#22d3ee",
  "#f43f5e",
  "#eab308",
  "#34d399",
];

export function peerColorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PEER_COLORS[hash % PEER_COLORS.length]!;
}

/** Upsert-by-key into a list of canvas objects that expose `.key`. */
export function upsertByKey<T extends { key: string }>(
  prev: T[],
  item: T,
): T[] {
  const idx = prev.findIndex((x) => x.key === item.key);
  if (idx < 0) return [...prev, item];
  const next = prev.slice();
  next[idx] = item;
  return next;
}

export function removeByKey<T extends { key: string }>(
  prev: T[],
  key: string,
): T[] {
  return prev.filter((x) => x.key !== key);
}

/** Merge presence state map from supabase-js into a flat peer list. */
export function peersFromPresenceState(
  state: Record<string, { metas?: Array<Record<string, unknown>> }>,
  selfKey: string,
): CanvasPeer[] {
  const peers: CanvasPeer[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (key === selfKey) continue;
    const meta = value.metas?.[value.metas.length - 1];
    if (!meta) continue;
    peers.push({
      key,
      name: typeof meta.name === "string" ? meta.name : "Estimator",
      color: typeof meta.color === "string" ? meta.color : peerColorForKey(key),
      x: typeof meta.x === "number" ? meta.x : undefined,
      y: typeof meta.y === "number" ? meta.y : undefined,
      updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : undefined,
    });
  }
  return peers;
}
