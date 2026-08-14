"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { useToast } from "@/components/common/Toast";
import { fetchWithRetry } from "@/lib/network/retry";

interface ProjectUploadButtonProps {
  projectId: string;
  variant?: "primary" | "ghost";
  label?: string;
  onUploaded?: () => void;
}

export default function ProjectUploadButton({
  projectId,
  variant = "primary",
  label = "Upload plans",
  onUploaded,
}: ProjectUploadButtonProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [cancelEnabled, setCancelEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const uploadViaSupabase = useCallback(async (file: File, signal?: AbortSignal) => {
    let documentId = "";
    try {
      const reserveRes = await fetchWithRetry("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          file_name: file.name,
          size: file.size,
          content_type: file.type || "application/octet-stream",
        }),
        signal,
      }, { retries: 1 });
      const reservation = await reserveRes.json().catch(() => ({})) as {
        document_id?: string;
        upload?: { url?: string };
        error?: string;
      };
      if (!reserveRes.ok || !reservation.document_id || !reservation.upload?.url) {
        throw new Error(reservation.error ?? `Could not start ${file.name} upload (${reserveRes.status}).`);
      }
      documentId = reservation.document_id;

      const uploadRes = await fetch(reservation.upload.url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "false",
        },
        body: file,
        signal,
      });
      if (!uploadRes.ok) {
        const detail = await uploadRes.text().catch(() => uploadRes.statusText);
        throw new Error(`Storage upload failed (${uploadRes.status}): ${detail.slice(0, 200)}`);
      }

      const finalizeRes = await fetchWithRetry("/api/documents/upload-url", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
        signal,
      }, { retries: 1 });
      const finalized = await finalizeRes.json().catch(() => ({})) as { error?: string };
      if (!finalizeRes.ok) {
        throw new Error(finalized.error ?? `Could not finalize ${file.name} (${finalizeRes.status}).`);
      }
      return finalized;
    } catch (error) {
      if (documentId) {
        await fetch("/api/documents/upload-url", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: documentId }),
        }).catch(() => {});
      }
      throw error;
    }
  }, [projectId]);

  const onChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    setUploading(true);
    setCancelEnabled(true);
    const failures: string[] = [];
    let successCount = 0;
    try {
      for (const file of files) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
        try {
          await uploadViaSupabase(file, ctrl.signal);
          successCount += 1;
          onUploaded?.();
        } catch (err) {
          const message = (err as { name?: string }).name === "AbortError"
            ? "Upload timed out after 10 minutes."
            : err instanceof Error ? err.message : String(err);
          failures.push(`${file.name}: ${message}`);
        } finally {
          clearTimeout(timer);
          if (abortRef.current === ctrl) abortRef.current = null;
        }
      }
      if (successCount > 0 && failures.length === 0) {
        toast({ title: String(`Uploaded ${successCount} file${successCount === 1 ? "" : "s"} and started processing.`), kind: "success" });
      } else if (successCount > 0) {
        toast({ title: String(`Uploaded ${successCount} file${successCount === 1 ? "" : "s"}. ${failures.length} file${failures.length === 1 ? "" : "s"} need attention.`), kind: "info" });
      }
      if (failures.length > 0) {
        toast({ title: String(`Some files could not be uploaded.\n\n${failures.join("\n")}\n\nTry again after refreshing the page or reconnecting Google if needed.`), kind: "error" });
      }
    } finally {
      setUploading(false);
      setCancelEnabled(false);
      abortRef.current = null;
    }
  }, [onUploaded, toast, uploadViaSupabase]);

  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploading(false);
    setCancelEnabled(false);
    toast({
      title: "Upload canceled",
      description: "You can start over whenever you're ready.",
      kind: "info",
    });
  }, [toast]);

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
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className={cls}
      >
        <Upload size={13} />
        {uploading ? "Uploading..." : label}
      </button>
      {uploading && cancelEnabled && (
        <button
          type="button"
          onClick={() => cancelUpload()}
          className="mt-2 inline-flex h-8 items-center rounded-full border border-white/15 bg-white/5 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/60 hover:text-white"
        >
          Cancel upload
        </button>
      )}
    </>
  );
}
