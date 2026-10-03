/**
 * CAD parser — proxies DWG/DXF/IFC uploads to the Onyx Python parser at
 * PYTHON_API_URL/api/takeoff/extract (same upstream used by
 * app/api/takeoff/extract). Returns a normalized CAD summary.
 */
import { currentUser } from "@clerk/nextjs/server";
import type { ParseResult, ParseContext } from "./index";
import { pythonApiBaseUrl, pythonApiHeaders } from "@/lib/python-api";

const PYTHON_API_URL = pythonApiBaseUrl();

interface UpstreamGeom {
  layers?: string[];
  entity_count?: number;
  entityCount?: number;
  bounds?: { minX?: number; minY?: number; maxX?: number; maxY?: number };
}

interface UpstreamPayload {
  layers?: string[];
  entity_count?: number;
  entityCount?: number;
  bounds?: UpstreamGeom["bounds"];
  geometry?: UpstreamGeom;
  summary?: UpstreamGeom;
  rows?: Array<Record<string, string | number | null>>;
}

export async function parseCad(
  bytes: Buffer,
  base: { filename: string; mime: string },
  ctx: ParseContext,
): Promise<ParseResult> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(bytes)], {
    type: base.mime || "application/octet-stream",
  });
  form.append("file", blob, base.filename);

  const user = await currentUser().catch(() => null);
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

  let upstream: Response;
  try {
    upstream = await fetch(`${PYTHON_API_URL}/api/takeoff/extract`, {
      method: "POST",
      headers: pythonApiHeaders({ email, tenantId: ctx.tenantId }),
      body: form,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "error",
      ...base,
      error: `CAD parser service is unreachable (${msg}). Please retry shortly; if this persists the Onyx Python service may be down.`,
    };
  }

  const text = await upstream.text().catch(() => "");
  if (!upstream.ok) {
    let detail = text;
    try { detail = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* keep */ }
    if (upstream.status >= 500 || upstream.status === 502 || upstream.status === 503 || upstream.status === 504) {
      return {
        kind: "error",
        ...base,
        error: `CAD parser service error (${upstream.status}). Please retry; service may be restarting.`,
      };
    }
    return {
      kind: "error",
      ...base,
      error: `CAD parser rejected file (${upstream.status}): ${detail.slice(0, 300)}`,
    };
  }

  let payload: UpstreamPayload = {};
  try { payload = JSON.parse(text) as UpstreamPayload; } catch { payload = {}; }

  const geom = payload.geometry ?? payload.summary ?? payload;
  const layers = Array.isArray(geom.layers) ? geom.layers.slice(0, 200) : undefined;
  const entityCount =
    typeof geom.entityCount === "number" ? geom.entityCount :
    typeof geom.entity_count === "number" ? geom.entity_count :
    undefined;
  const b = geom.bounds;
  const bounds =
    b && typeof b.minX === "number" && typeof b.minY === "number" &&
    typeof b.maxX === "number" && typeof b.maxY === "number"
      ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
      : undefined;

  return {
    kind: "cad",
    ...base,
    cad: { layers, entityCount, bounds },
    rows: Array.isArray(payload.rows) ? payload.rows : undefined,
  };
}
