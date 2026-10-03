"use client";

import { useCallback, useState } from "react";
import { Cloud } from "lucide-react";
import { useToast } from "@/components/common/Toast";

type CloudProvider = "dropbox" | "sharefile";

interface ListedFile {
  id: string;
  name: string;
  mime?: string | null;
  size?: number | null;
  path?: string | null;
}

export default function CloudImportPanel({
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
  const [provider, setProvider] = useState<CloudProvider>("dropbox");
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async (p: CloudProvider, folder = "") => {
    setLoading(true);
    setHint(null);
    try {
      const qs = new URLSearchParams({ provider: p });
      if (folder) qs.set("path", folder);
      const res = await fetch(`/api/documents/import-cloud?${qs.toString()}`);
      const data = await res.json() as {
        files?: ListedFile[];
        error?: string;
        hint?: string;
        connected?: boolean;
      };
      if (res.status === 401 || data.connected === false) {
        setHint(data.hint ?? "Connect this provider under Settings → Connections.");
        setFiles([]);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `List failed (${res.status})`);
      setFiles(data.files ?? []);
      if (data.hint) setHint(data.hint);
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const openPanel = async () => {
    setOpen(true);
    await load(provider, path);
  };

  const importOne = async (f: ListedFile) => {
    if (!confirm(`Import “${f.name}” into this project from ${provider}?`)) return;
    setImporting(f.id);
    try {
      const res = await fetch("/api/documents/import-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          project_id: projectId,
          file_id: f.id,
          name: f.name,
          mime: f.mime,
          path: f.path ?? undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
      toast({ title: `Imported ${f.name}`, kind: "success" });
      onImported?.();
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), kind: "error" });
    } finally {
      setImporting(null);
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
        <Cloud size={13} />
        From Cloud
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(100vw-2rem,28rem)] rounded-xl border border-white/10 bg-[#0c0d10] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-white">Dropbox / ShareFile</p>
            <button type="button" className="text-xs text-white/40 hover:text-white" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="mb-2 flex gap-2">
            {(["dropbox", "sharefile"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setProvider(p);
                  void load(p, "");
                }}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest ${
                  provider === p ? "bg-[#CCFF00] text-black" : "bg-white/5 text-white/50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="mb-2 flex gap-2">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Folder path (optional)"
              className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white"
            />
            <button
              type="button"
              onClick={() => void load(provider, path)}
              className="rounded bg-white/10 px-2 py-1 text-[10px] text-white/70"
            >
              List
            </button>
          </div>

          <p className="mb-2 text-[10px] text-white/35">
            iCloud has no web Drive API — use Upload or Email import instead.
          </p>

          {hint && (
            <p className="mb-2 text-xs text-amber-200/90">
              {hint}{" "}
              <a href="/dashboard/settings/connections" className="underline">Connections</a>
            </p>
          )}

          {loading ? (
            <p className="py-4 text-center text-xs text-white/40">Listing…</p>
          ) : files.length === 0 ? (
            <p className="py-4 text-center text-xs text-white/40">No files in this folder.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 px-2 py-2">
                  <p className="truncate text-xs text-white">{f.name}</p>
                  <button
                    type="button"
                    disabled={!!importing}
                    onClick={() => void importOne(f)}
                    className="shrink-0 rounded bg-[#CCFF00]/15 px-2 py-1 text-[10px] font-semibold text-[#CCFF00] disabled:opacity-50"
                  >
                    {importing === f.id ? "…" : "Import"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
