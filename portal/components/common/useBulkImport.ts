"use client";

import { useCallback } from "react";
import type { ParseResult } from "./UniversalImportButton";

import { useToast } from "@/components/common/Toast";

interface BulkImportOptions<TPayload> {
  /** API endpoint that creates ONE entity per POST. */
  endpoint: string;
  /** Map a parsed row to the create payload. Return null to skip the row. */
  mapRow: (row: Record<string, string | number | null>, projectId: string) => TPayload | null;
  /** Optional: map text/entities from non-tabular parse results (PDF/image). */
  mapEntities?: (entities: Array<{ type: string; value: string }>, projectId: string) => TPayload[];
  /** Called after import completes with counts. */
  onComplete?: (created: number, failed: number, errors: string[]) => void;
}

/**
 * Bulk-imports parsed rows from UniversalImportButton into a CRUD endpoint.
 * For tabular files (xlsx, csv, docx-with-table) it iterates rows.
 * For PDFs/images it uses mapEntities if provided.
 */
export function useBulkImport<TPayload>(projectId: string, opts: BulkImportOptions<TPayload>) {
  const { toast } = useToast();
  return useCallback(async (parsed: ParseResult) => {
    if (parsed.kind === "error") {
      toast({ title: String(`Import failed: ${parsed.error ?? "unknown error"}`), kind: "error" });
      return;
    }

    let payloads: TPayload[] = [];

    if (parsed.kind === "rows" && parsed.rows) {
      for (const row of parsed.rows) {
        const p = opts.mapRow(row, projectId);
        if (p) payloads.push(p);
      }
    } else if ((parsed.kind === "image" || parsed.kind === "cad") && parsed.entities && opts.mapEntities) {
      payloads = opts.mapEntities(parsed.entities, projectId);
    } else if (parsed.kind === "text") {
      toast({ title: String(`Imported "${parsed.filename}" as text. Plain-text bulk import isn't supported on this tab - paste content into a manual entry instead.`), kind: "error" });
      return;
    }

    if (payloads.length === 0) {
      toast({ title: String("Nothing to import - the file didn't contain rows that map to this section."), kind: "info" });
      return;
    }

    let created = 0;
    let failed = 0;
    let consecutiveAuthFails = 0;
    let aborted = false;
    const errors: string[] = [];

    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      try {
        const res = await fetch(opts.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          failed++;
          if (res.status === 401 || res.status === 403) {
            consecutiveAuthFails++;
          } else {
            consecutiveAuthFails = 0;
          }
          const body = await res.json().catch(() => ({})) as { error?: string };
          if (body.error && errors.length < 5) errors.push(`[${res.status}] ${body.error}`);
          else if (errors.length < 5) errors.push(`HTTP ${res.status}`);
          // Abort early if the first 3 calls fail with auth - no point spamming the server.
          if (consecutiveAuthFails >= 3 && i < 3) {
            aborted = true;
            errors.unshift("Aborted: not authorized to create these records. Please re-authenticate.");
            break;
          }
        } else {
          created++;
          consecutiveAuthFails = 0;
        }
      } catch (err) {
        failed++;
        consecutiveAuthFails = 0;
        if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    opts.onComplete?.(created, failed, errors);

    const total = payloads.length;
    const summaryHead = aborted
      ? `Import stopped after ${created + failed} of ${total} items.`
      : `Imported ${created} of ${total} item${total === 1 ? "" : "s"}${failed > 0 ? `. ${failed} need a retry.` : "."}`;
    if (errors.length > 0) {
      toast({ title: String(`${summaryHead}\n\nFirst few errors:\n${errors.join("\n")}`), kind: "error" });
    } else {
      toast({ title: String(summaryHead), kind: "info" });
    }
  }, [projectId, opts, toast]);
}

/**
 * Defensive value coercion helpers for mapRow implementations. Use these in
 * each tab's mapRow so number/string/null variations don't crash.
 */
export function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Strip $, commas, whitespace, trailing %.
    const cleaned = v.replace(/[$,\s]/g, "").replace(/%$/, "");
    if (cleaned === "" || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  if (typeof v === "number") {
    // Excel serial date - days since 1899-12-30 (Lotus bug compat).
    if (v > 59 && v < 100000) {
      const ms = (v - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    }
    return null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  return null;
}
