import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/google/oauth";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";

export const runtime = "nodejs";

/**
 * GET /api/google/gmail/unread?limit=8&q=<extra-filter>
 *
 * Returns a flat list of unread threads' most recent message. The dashboard
 * widget renders these — subject, snippet, from, timestamp — one click opens
 * the thread in Gmail.
 *
 * Only reads message *metadata* headers + snippets — no full body content is
 * pulled server-side, minimizing what we ever touch.
 */
interface GmailThreadSummary {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  received_at: string | null;
  unread: boolean;
  gmail_url: string;
}

interface GmailHeader { name: string; value: string }
interface GmailMessageMinimal {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId, orgSlug } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
    const token = await getAccessToken(tenantId, userId);
    if (!token) {
      return NextResponse.json({ threads: [], connected: false }, { status: 200 });
    }

    const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10) || 8));
    const extraQ = req.nextUrl.searchParams.get("q") ?? "";

    // `is:unread in:inbox` covers the common case; caller can narrow further
    // via `q` (e.g. `label:client-emails`).
    const query = ["is:unread", "in:inbox", extraQ.trim()].filter(Boolean).join(" ");

    // Step 1: list unread thread IDs.
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", String(limit));

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!listRes.ok) {
      const detail = await listRes.text().catch(() => listRes.statusText);
      return NextResponse.json({ error: `Gmail list ${listRes.status}: ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> };
    const messages = listData.messages ?? [];
    if (messages.length === 0) {
      return NextResponse.json({ threads: [], connected: true }, {
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }

    // Step 2: fetch metadata for each message in parallel. `format=metadata` avoids
    // pulling message bodies — we only need headers + snippet for the widget.
    const detail = await Promise.all(
      messages.map(async (m) => {
        const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}`);
        url.searchParams.set("format", "metadata");
        url.searchParams.set("metadataHeaders", "From");
        url.searchParams.append("metadataHeaders", "Subject");
        url.searchParams.append("metadataHeaders", "Date");
        const r = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!r.ok) return null;
        return (await r.json()) as GmailMessageMinimal;
      }),
    );

    const threads: GmailThreadSummary[] = detail
      .filter((m): m is GmailMessageMinimal => !!m)
      .map((m) => {
        const subject = header(m.payload?.headers, "Subject") || "(no subject)";
        const from = header(m.payload?.headers, "From") || "";
        const received = m.internalDate ? new Date(parseInt(m.internalDate, 10)).toISOString() : null;
        return {
          id: m.threadId,
          subject,
          from,
          snippet: m.snippet ?? "",
          received_at: received,
          unread: (m.labelIds ?? []).includes("UNREAD"),
          gmail_url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(m.threadId)}`,
        };
      });

    return NextResponse.json({ threads, connected: true }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[gmail/unread] ${msg}` }, { status: 500 });
  }
}
