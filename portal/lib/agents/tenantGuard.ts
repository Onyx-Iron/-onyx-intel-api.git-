/**
 * Tenant Guard — defensive security tool. Scans recent (or supplied) changed
 * .ts/.tsx files in the portal source tree for Supabase queries that omit a
 * tenant_id filter. Produces a PR-comment-style report with findings.
 *
 * Triggered manually for now; CI integration possible later.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export interface TenantGuardFinding {
  file: string;
  line: number;
  snippet: string;
  suggestion: string;
}

export interface TenantGuardResult {
  run_id: string;
  findings: TenantGuardFinding[];
  files_scanned: number;
}

const PORTAL_ROOT = resolve(process.cwd());
const TENANT_EQ_RE = /\.eq\(\s*["']tenant_id["']/;
// Match a Supabase .from("table").<op> chain — captures the op
const FROM_OP_RE = /\.from\(\s*["']([a-zA-Z_][\w]*)["']\s*\)([\s\S]{0,800}?)\.(select|update|delete|insert)\s*\(/g;
// Tables the agent does NOT need to guard (no tenant_id column on them)
const EXEMPT_TABLES = new Set([
  "tenants",
  "google_connections",
  "messages",
  "conversations",
  "pages",
]);

function listChangedFiles(): string[] {
  try {
    const out = execFileSync(
      "git",
      ["log", "--since=7 days ago", "--name-only", "--pretty=format:"],
      { cwd: PORTAL_ROOT, encoding: "utf8", timeout: 15_000 },
    );
    const set = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.endsWith(".ts") || trimmed.endsWith(".tsx")) set.add(trimmed);
    }
    return [...set];
  } catch {
    return [];
  }
}

function lineNumberOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function snippetAround(source: string, index: number, length: number): string {
  const start = Math.max(0, source.lastIndexOf("\n", index) + 1);
  const end = Math.min(source.length, source.indexOf("\n", index + length));
  return source.slice(start, end === -1 ? source.length : end).trim().slice(0, 240);
}

export function scanFileForTenantOmissions(
  relPath: string,
  source: string,
): TenantGuardFinding[] {
  const findings: TenantGuardFinding[] = [];
  FROM_OP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FROM_OP_RE.exec(source)) !== null) {
    const [match, table, betweenChain, op] = m;
    if (EXEMPT_TABLES.has(table)) continue;
    // Look at the surrounding chained call window — 1.2k chars after the op call
    const tailStart = m.index + match.length;
    const window = source.slice(m.index, tailStart + 1200);
    if (TENANT_EQ_RE.test(window) || TENANT_EQ_RE.test(betweenChain)) continue;
    findings.push({
      file: relPath,
      line: lineNumberOf(source, m.index),
      snippet: snippetAround(source, m.index, match.length),
      suggestion:
        `Add \`.eq("tenant_id", tenantId)\` to this \`.from("${table}").${op}(...)\` chain ` +
        `to enforce tenant isolation.`,
    });
  }
  return findings;
}

function isSourceFile(path: string): boolean {
  return (path.endsWith(".ts") || path.endsWith(".tsx")) &&
    !path.endsWith(".d.ts") &&
    !path.includes("node_modules") &&
    !path.includes(".test.");
}

export async function runTenantGuard(
  tenantId: string,
  suppliedFiles?: string[],
): Promise<TenantGuardResult> {
  const db = await createServiceClient();
  const startedAt = new Date().toISOString();

  const { data: runRow, error: insertErr } = await db
    .from("agent_runs")
    .insert({
      tenant_id: tenantId,
      project_id: null,
      agent_kind: "tenant_guard",
      status: "running",
      input: { files: suppliedFiles ?? null },
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (insertErr || !runRow) {
    throw new Error(`[tenant_guard] insert run failed: ${insertErr?.message ?? "no row"}`);
  }
  const runId = (runRow as { id: string }).id;

  try {
    const candidates = (suppliedFiles && suppliedFiles.length > 0
      ? suppliedFiles
      : listChangedFiles()
    ).filter(isSourceFile);

    const findings: TenantGuardFinding[] = [];
    let scanned = 0;
    for (const rel of candidates) {
      const abs = join(PORTAL_ROOT, rel.replace(/^portal\//, ""));
      let source: string;
      try {
        source = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      scanned++;
      findings.push(...scanFileForTenantOmissions(rel, source));
    }

    await db
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: { findings, files_scanned: scanned } as unknown as Json,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { run_id: runId, findings, files_scanned: scanned };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .from("agent_runs")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
      .eq("id", runId);
    throw err;
  }
}
