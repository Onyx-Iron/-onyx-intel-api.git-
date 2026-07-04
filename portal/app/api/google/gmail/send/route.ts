import { NextRequest, NextResponse } from "next/server";
import { requireGoogleToken } from "@/lib/google/api";

export const runtime = "nodejs";

// Build an RFC-2822 message and base64url-encode it for the Gmail API.
function buildRaw(to: string, subject: string, body: string, cc?: string): string {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean).join("\r\n");
  const msg = `${headers}\r\n\r\n${body}`;
  return Buffer.from(msg, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const t = await requireGoogleToken(req);
  if (!t.ok) return NextResponse.json({ error: t.error, code: t.code }, { status: t.status });

  const { to, subject, body, cc } = await req.json() as { to?: string; subject?: string; body?: string; cc?: string };
  if (!to || !subject || !body) return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: buildRaw(to, subject, body, cc) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return NextResponse.json({ error: `[gmail ${res.status}] ${detail.slice(0, 300)}` }, { status: 502 });
  }
  const data = await res.json() as { id?: string };
  return NextResponse.json({ ok: true, message_id: data.id });
}
