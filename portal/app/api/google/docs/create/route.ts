import { NextRequest, NextResponse } from "next/server";
import { requireGoogleToken } from "@/lib/google/api";

export const runtime = "nodejs";

/**
 * Create a Google Doc from text (e.g. an AI-generated RFI / submittal / scope).
 * Creates the doc, then inserts the content, and returns its shareable URL.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const t = await requireGoogleToken(req);
  if (!t.ok) return NextResponse.json({ error: t.error, code: t.code }, { status: t.status });

  const { title, content } = await req.json() as { title?: string; content?: string };
  if (!title || !content) return NextResponse.json({ error: "title and content are required" }, { status: 400 });

  // 1. Create an empty document
  const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
    method: "POST",
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => createRes.statusText);
    return NextResponse.json({ error: `[docs create ${createRes.status}] ${detail.slice(0, 300)}` }, { status: 502 });
  }
  const doc = await createRes.json() as { documentId?: string };
  if (!doc.documentId) return NextResponse.json({ error: "No document id returned" }, { status: 502 });

  // 2. Insert the content at the start
  const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
  });
  if (!updateRes.ok) {
    const detail = await updateRes.text().catch(() => updateRes.statusText);
    return NextResponse.json({ error: `[docs write ${updateRes.status}] ${detail.slice(0, 300)}`, url: `https://docs.google.com/document/d/${doc.documentId}/edit` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, document_id: doc.documentId, url: `https://docs.google.com/document/d/${doc.documentId}/edit` });
}
