const PUT_TIMEOUT_MS = 10 * 60 * 1000;

interface StorageSession {
  document_id?: string;
  error?: string;
  upload?: { url?: string };
}

/**
 * Browser uploads straight into plans-bucket, then asks ingest to queue the
 * page splitter. The file bytes never pass through the Vercel function.
 */
export async function uploadLocalFile(projectId: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const sessionRes = await fetch("/api/documents/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storage_type: "storage",
      project_id: projectId,
      file_name: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
  const session = await sessionRes.json().catch(() => ({})) as StorageSession;
  if (!sessionRes.ok || !session.document_id || !session.upload?.url) {
    return { ok: false, error: session.error ?? "Could not start upload" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PUT_TIMEOUT_MS);
  try {
    const putRes = await fetch(session.upload.url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: file,
      signal: ctrl.signal,
    });
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => "");
      return { ok: false, error: `Storage upload failed (${putRes.status}): ${detail.slice(0, 200)}` };
    }
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      return { ok: false, error: "Upload timed out after 10 minutes." };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }

  const ingestRes = await fetch(`/api/documents/${encodeURIComponent(session.document_id)}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!ingestRes.ok) {
    const data = await ingestRes.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: data.error ?? "Could not start processing" };
  }
  return { ok: true };
}
