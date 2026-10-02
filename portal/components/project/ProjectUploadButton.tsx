"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { useToast } from "@/components/common/Toast";

interface ProjectUploadButtonProps {
  projectId: string;
  variant?: "primary" | "ghost";
  label?: string;
  onUploaded?: () => void;
}

export default function ProjectUploadButton({
  projectId,
  variant = "primary",
  label = "Upload Plans",
  onUploaded,
}: ProjectUploadButtonProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    setUploading(true);
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          const sessionRes = await fetch("/api/documents/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storage_type: "drive",
              file_name: file.name,
              content_type: file.type || "application/octet-stream",
              project_id: projectId,
            }),
          });
          const sessionData = await sessionRes.json() as { upload_url?: string; error?: string; code?: string };
          if (!sessionRes.ok) {
            if (sessionData.code === "NEED_GOOGLE") {
              failures.push(`${file.name}: Google Drive not connected. Connect Google from the dashboard, then retry.`);
            } else {
              failures.push(`${file.name}: ${sessionData.error ?? "could not start upload"}`);
            }
            continue;
          }

          // 10-minute timeout so a hung PUT (e.g. Drive token expiring mid-upload)
          // surfaces as a clear error rather than leaving the button stuck on "Uploading…".
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
          let uploadRes: Response;
          try {
            uploadRes = await fetch(sessionData.upload_url!, {
              method: "PUT",
              headers: { "Content-Type": file.type || "application/octet-stream" },
              body: file,
              signal: ctrl.signal,
            });
          } catch (err) {
            if ((err as { name?: string }).name === "AbortError") {
              failures.push(`${file.name}: Drive upload timed out (Google sign-in may have expired — reconnect Google and retry)`);
              continue;
            }
            throw err;
          } finally {
            clearTimeout(timer);
          }
          if (!uploadRes.ok) {
            if (uploadRes.status === 401 || uploadRes.status === 403) {
              failures.push(`${file.name}: Drive rejected upload (${uploadRes.status}) — Google sign-in expired. Reconnect Google and retry.`);
            } else {
              failures.push(`${file.name}: Drive upload failed (${uploadRes.status})`);
            }
            continue;
          }
          const driveFile = await uploadRes.json() as { id?: string };
          if (!driveFile.id) {
            failures.push(`${file.name}: Drive did not return file id`);
            continue;
          }

          // Unified endpoint inserts the row and auto-fires ingest
          const regRes = await fetch("/api/documents/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storage_type: "drive",
              project_id: projectId,
              file_name: file.name,
              drive_file_id: driveFile.id,
              mime_type: file.type,
              size: file.size,
            }),
          });
          if (!regRes.ok) {
            const d = await regRes.json().catch(() => ({})) as { error?: string };
            failures.push(`${file.name}: ${d.error ?? "registration failed"}`);
            continue;
          }
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      onUploaded?.();
      if (failures.length > 0) {
        toast({ title: String(`Some files could not be uploaded:\n\n${failures.join("\n")}`), kind: "error" });
      }
    } finally {
      setUploading(false);
    }
  }, [projectId, onUploaded]);

  const isPrimary = variant === "primary";
  const cls = isPrimary
    ? "inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:opacity-50"
    : "inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-xs font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50";

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.dwg,.dxf,.tiff,.tif,.jpg,.jpeg,.png"
        className="hidden"
        onChange={onChange}
      />
      <button
        id="upload-plans-pill"
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className={cls}
      >
        <Upload size={13} />
        {uploading ? "Uploading…" : label}
      </button>
    </>
  );
}
