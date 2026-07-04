// Supabase Edge Function: page-split-worker
// Deno runtime.
//
// Contract (from /api/documents/import-drive):
//   POST {
//     document_id, tenant_id, project_id,
//     drive_file_id, original_path,
//     access_token, user_id
//   }
//
// Pipeline:
//   1. Stream the file from Google Drive into `plans-bucket/{original_path}`.
//   2. Load the PDF via pdf-lib.
//   3. Update `documents.page_count`.
//   4. Burst each page into a standalone 1-page PDF at
//      `plans-bucket/pages/{document_id}/page-{n}.pdf`.
//   5. Insert `document_pages` rows (status="pending").
//   6. Enqueue each page for `page-processor` by invoking that function
//      per-page (fire-and-forget).
//
// This function must be deployed with `supabase functions deploy page-split-worker`
// and needs env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANS_BUCKET (default "plans-bucket").

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLANS_BUCKET       = Deno.env.get("PLANS_BUCKET") ?? "plans-bucket";

interface Payload {
  document_id: string;
  tenant_id: string;
  project_id: string;
  drive_file_id: string;
  original_path: string;
  access_token: string;
  user_id: string;
}

Deno.serve(async (req) => {
  const started = Date.now();
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Mark the document as processing right away so the UI can reflect status.
  await db.from("documents")
    .update({ status: "processing" })
    .eq("id", body.document_id)
    .eq("tenant_id", body.tenant_id);

  try {
    // ── 1. Stream from Drive → Supabase Storage ──────────────────────────────
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.drive_file_id)}?alt=media`;
    const driveRes = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    if (!driveRes.ok || !driveRes.body) {
      throw new Error(`Drive fetch ${driveRes.status}: ${(await driveRes.text().catch(() => "")).slice(0, 200)}`);
    }

    // Buffer the response (Supabase JS upload wants a Blob/ArrayBuffer, not a stream).
    const originalBytes = new Uint8Array(await driveRes.arrayBuffer());

    const upOrig = await db.storage.from(PLANS_BUCKET)
      .upload(body.original_path, originalBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upOrig.error) throw new Error(`upload original: ${upOrig.error.message}`);

    // ── 2. Load PDF ──────────────────────────────────────────────────────────
    const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const pageCount = pdf.getPageCount();

    // ── 3. page_count ────────────────────────────────────────────────────────
    await db.from("documents")
      .update({ page_count: pageCount })
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id);

    // ── 4-5. Burst + insert document_pages ───────────────────────────────────
    const pageRows: Array<{
      id: string; tenant_id: string; document_id: string; page_number: number;
      storage_path: string; status: string;
    }> = [];

    // pdf-lib doesn't stream; iterate sequentially. For huge decks (500+ pages)
    // we may want to batch these uploads later, but for typical 20-200 page
    // plansets this is well within the 150s Edge Function ceiling.
    for (let i = 0; i < pageCount; i++) {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(pdf, [i]);
      single.addPage(copied);
      const pageBytes = await single.save();

      const pageNumber = i + 1;
      const storagePath = `pages/${body.document_id}/page-${pageNumber}.pdf`;

      const upPage = await db.storage.from(PLANS_BUCKET)
        .upload(storagePath, pageBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upPage.error) {
        console.warn(`[page-split] upload page ${pageNumber} failed: ${upPage.error.message}`);
        continue;
      }

      pageRows.push({
        id: crypto.randomUUID(),
        tenant_id: body.tenant_id,
        document_id: body.document_id,
        page_number: pageNumber,
        storage_path: storagePath,
        status: "pending",
      });
    }

    if (pageRows.length > 0) {
      const { error: insErr } = await db.from("document_pages").insert(pageRows);
      if (insErr) throw new Error(`insert document_pages: ${insErr.message}`);
    }

    // ── 6. Fan out: fire-and-forget each page to page-processor ──────────────
    const workerUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/page-processor`;
    await Promise.allSettled(pageRows.map((p) =>
      fetch(workerUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_id: p.id,
          document_id: p.document_id,
          tenant_id: p.tenant_id,
          page_number: p.page_number,
          storage_path: p.storage_path,
        }),
      })
    ));

    // Mark documents.status="split" — pages are now the unit of work.
    await db.from("documents")
      .update({ status: "split" })
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id);

    return new Response(JSON.stringify({
      ok: true,
      document_id: body.document_id,
      page_count: pageCount,
      pages_enqueued: pageRows.length,
      elapsed_ms: Date.now() - started,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[page-split-worker]", err);
    await db.from("documents")
      .update({ status: "error", error: String(err?.message ?? err).slice(0, 500) } as any)
      .eq("id", body.document_id)
      .eq("tenant_id", body.tenant_id);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500 });
  }
});
