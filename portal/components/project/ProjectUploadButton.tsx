"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { useToast } from "@/components/common/Toast";
import { uploadLocalFile } from "@/lib/documents/upload-client";

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
          const uploaded = await uploadLocalFile(projectId, file);
          if (!uploaded.ok) failures.push(`${file.name}: ${uploaded.error}`);
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
