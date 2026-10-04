"use client";

import { useCallback, useState } from "react";
import { Mail } from "lucide-react";
import { useToast } from "@/components/common/Toast";

interface PlanAttachment {
  message_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  subject: string;
  from: string;
  received_at: string | null;
}

export default function EmailImportPanel({
  projectId,
  onImported,
  disabled,
}: {
  projectId: string;
  onImported?: () => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PlanAttachment[]>([]);
  const [connected, setConnected] = useState(true);
  const [createBidCard, setCreateBidCard] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/google/gmail/plan-attachments?limit=20");
      const data = await res.json() as {
        attachments?: PlanAttachment[];
        connected?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Load failed (${res.status})`);
      setConnected(data.connected !== false);
      setAttachments(data.attachments ?? []);
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const openPanel = async () => {
    setOpen(true);
    await load();
  };

  const importOne = async (a: PlanAttachment) => {
    const key = `${a.message_id}:${a.attachment_id}`;
    if (!confirm(`Import “${a.filename}” into this project?`)) return;
    setImportingKey(key);
    try {
      const res = await fetch("/api/google/gmail/import-attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          message_id: a.message_id,
          attachment_id: a.attachment_id,
          filename: a.filename,
          mime_type: a.mime_type,
          create_bid_card: createBidCard,
          bid_name: a.subject,
        }),
      });
      const data = await res.json() as { error?: string; document_id?: string };
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
      toast({ title: `Imported ${a.filename}`, kind: "success" });
      onImported?.();
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setImportingKey(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => void openPanel()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
      >
        <Mail size={13} />
        From Email
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(100vw-2rem,28rem)] rounded-xl border border-white/10 bg-[#0c0d10] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-white">Plan attachments in Gmail</p>
            <button
              type="button"
              className="text-xs text-white/40 hover:text-white"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          {!connected && (
            <p className="mb-2 text-xs text-amber-200/90">
              Google is not connected.{" "}
              <a href="/dashboard/settings/connections" className="underline">
                Connect in Settings
              </a>
            </p>
          )}

          <label className="mb-2 flex items-center gap-2 text-[11px] text-white/50">
            <input
              type="checkbox"
              checked={createBidCard}
              onChange={(e) => setCreateBidCard(e.target.checked)}
              className="rounded border-white/20"
            />
            Also create a Bid Board card
          </label>

          {loading ? (
            <p className="py-4 text-center text-xs text-white/40">Scanning inbox…</p>
          ) : attachments.length === 0 ? (
            <p className="py-4 text-center text-xs text-white/40">
              No PDF/DWG/DXF attachments found in the last 30 days.
            </p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {attachments.map((a) => {
                const key = `${a.message_id}:${a.attachment_id}`;
                return (
                  <li
                    key={key}
                    className="flex items-start justify-between gap-2 rounded-lg border border-white/5 px-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">{a.filename}</p>
                      <p className="truncate text-[10px] text-white/40">{a.subject}</p>
                      <p className="truncate text-[10px] text-white/30">{a.from}</p>
                    </div>
                    <button
                      type="button"
                      disabled={!!importingKey}
                      onClick={() => void importOne(a)}
                      className="shrink-0 rounded bg-[#CCFF00]/15 px-2 py-1 text-[10px] font-semibold text-[#CCFF00] disabled:opacity-50"
                    >
                      {importingKey === key ? "…" : "Import"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
