import { NextRequest, NextResponse } from "next/server";
import { requireGoogleToken } from "@/lib/google/api";
import { assertPermission, PermissionError } from "@/lib/project-controls/permissions";
import { auditInsert } from "@/lib/audit";
import { hasHeaderInjection, isValidEmailList, requiresExplicitConfirmation } from "@/lib/google/external-action";

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
  try {
    const t = await requireGoogleToken(req);
    if (!t.ok) return NextResponse.json({ error: t.error, code: t.code }, { status: t.status });
    await assertPermission(t.tenantId, t.userId, "field", "write");

    const { to, subject, body, cc, confirmed } = await req.json() as { to?: string; subject?: string; body?: string; cc?: string; confirmed?: boolean };
    if (!to || !subject || !body) return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
    if (requiresExplicitConfirmation(confirmed)) return NextResponse.json({ error: "Explicit confirmation is required before sending email", code: "CONFIRMATION_REQUIRED" }, { status: 409 });
    if (!isValidEmailList(to) || (cc && !isValidEmailList(cc)) || hasHeaderInjection(subject)) {
      return NextResponse.json({ error: "Invalid email headers" }, { status: 400 });
    }
    if (subject.length > 300 || body.length > 100_000) return NextResponse.json({ error: "Email exceeds allowed size" }, { status: 413 });

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
    auditInsert({ tenant_id: t.tenantId, user_id: t.userId, table_name: "external_google_email", record_id: data.id ?? crypto.randomUUID(), new_values: { to, cc: cc ?? null, subject } });
    return NextResponse.json({ ok: true, message_id: data.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PermissionError ? 403 : 500 });
  }
}
