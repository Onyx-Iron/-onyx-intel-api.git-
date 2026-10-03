/**
 * Gmail helpers for discovering and downloading plan attachments.
 */

export interface GmailPlanAttachment {
  message_id: string;
  thread_id: string;
  subject: string;
  from: string;
  received_at: string | null;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  gmail_url: string;
}

interface GmailHeader { name: string; value: string }
interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[]; parts?: GmailPart[]; filename?: string; mimeType?: string; body?: GmailPart["body"] };
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function collectAttachments(part: GmailPart | undefined, out: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>): void {
  if (!part) return;
  const filename = part.filename?.trim() ?? "";
  const attachmentId = part.body?.attachmentId;
  if (filename && attachmentId) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".pdf") || lower.endsWith(".dwg") || lower.endsWith(".dxf") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      out.push({
        attachmentId,
        filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
      });
    }
  }
  for (const child of part.parts ?? []) collectAttachments(child, out);
}

export async function listPlanAttachments(
  accessToken: string,
  opts: { limit?: number; extraQuery?: string; newerThanDays?: number } = {},
): Promise<GmailPlanAttachment[]> {
  const limit = Math.min(25, Math.max(1, opts.limit ?? 15));
  const days = opts.newerThanDays ?? 30;
  const parts = [
    "has:attachment",
    `(filename:pdf OR filename:dwg OR filename:dxf OR filename:xlsx)`,
    `newer_than:${days}d`,
    opts.extraQuery?.trim() ?? "",
  ].filter(Boolean);
  const query = parts.join(" ");

  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(limit));

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!listRes.ok) {
    const detail = await listRes.text().catch(() => listRes.statusText);
    throw new Error(`Gmail list ${listRes.status}: ${detail.slice(0, 200)}`);
  }

  const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> };
  const messages = listData.messages ?? [];
  const results: GmailPlanAttachment[] = [];

  for (const m of messages) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!msgRes.ok) continue;
    const msg = await msgRes.json() as GmailMessage;
    const attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> = [];
    collectAttachments(msg.payload as GmailPart, attachments);
    // Also check top-level payload if it's a single-part attachment message
    if (msg.payload?.filename && msg.payload.body?.attachmentId) {
      collectAttachments(msg.payload as GmailPart, attachments);
    }
    const subject = header(msg.payload?.headers, "Subject") || "(no subject)";
    const from = header(msg.payload?.headers, "From");
    const received = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : null;

    for (const a of attachments) {
      results.push({
        message_id: msg.id,
        thread_id: msg.threadId,
        subject,
        from,
        received_at: received,
        attachment_id: a.attachmentId,
        filename: a.filename,
        mime_type: a.mimeType,
        size: a.size,
        gmail_url: `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
      });
    }
  }

  return results;
}

/** Gmail attachment bodies are base64url-encoded. */
export function decodeGmailBase64Url(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Uint8Array.from(Buffer.from(b64 + pad, "base64"));
}

export async function downloadGmailAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}` +
    `/attachments/${encodeURIComponent(attachmentId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Gmail attachment ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json() as { data?: string };
  if (!data.data) throw new Error("Gmail attachment response missing data");
  return decodeGmailBase64Url(data.data);
}
