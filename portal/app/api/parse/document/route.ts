/**
 * POST /api/parse/document
 * Universal file parser endpoint — accepts any supported engineering /
 * construction file format as `file` in multipart/form-data and returns a
 * normalized ParseResult. Tenant-isolated. Does not persist anything.
 *
 * Query params:
 *   hint = takeoff | estimate | vendors | invoices | punch | contacts | docs
 *          (biases the Gemini entity-extraction prompt for PDFs and images)
 */
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { parseFile, type ParseHint } from "@/lib/parse";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const VALID_HINTS: ReadonlyArray<ParseHint> = [
  "takeoff", "estimate", "vendors", "invoices", "punch", "contacts", "docs",
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(
      authTenantKey(userId, orgId),
      authTenantName(userId, orgSlug),
    );
    await assertPermission(tenantId, userId, "field", "read");
    const hintParam = req.nextUrl.searchParams.get("hint");
    const hint = hintParam && (VALID_HINTS as readonly string[]).includes(hintParam)
      ? (hintParam as ParseHint)
      : undefined;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a 'file' field" },
        { status: 400 },
      );
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit` },
        { status: 413 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { kind: "error", error: "File is empty (0 bytes). Please choose a non-empty file." },
        { status: 422 },
      );
    }

    const filename =
      "name" in file && typeof (file as File).name === "string" && (file as File).name
        ? (file as File).name
        : "upload.bin";
    const mime = file.type || "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json(
        { kind: "error", filename, mime, error: "File is empty (0 bytes)." },
        { status: 422 },
      );
    }

    const rl = await checkAiRateLimit(tenantId, "parse/document", { windowMs: 60_000, max: 10 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many document parsing requests — please slow down." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const result = await parseFile(filename, mime, bytes, { tenantId, userId, hint });

    if (result.kind === "error") {
      const status = result.error?.startsWith("Unsupported file type") ? 415 : 422;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `[POST /api/parse/document] ${msg}` },
      { status: err instanceof PermissionError ? 403 : 500 },
    );
  }
}
