"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

import { useToast } from "@/components/common/Toast";

export interface ParseResult {
  kind: "rows" | "text" | "image" | "cad" | "error";
  filename: string;
  mime: string;
  rows?: Array<Record<string, string | number | null>>;
  headers?: string[];
  text?: string;
  entities?: Array<{ type: string; value: string; page?: number; confidence?: number }>;
  error?: string;
}

interface UniversalImportButtonProps {
  onParsed: (result: ParseResult) => void;
  hint?: string;
  label?: string;
  caption?: string;
  disabled?: boolean;
}

const ACCEPT = ".xlsx,.xls,.csv,.docx,.pdf,.tiff,.tif,.png,.jpg,.jpeg,.dwg,.dxf";

export function UniversalImportButton({
  onParsed,
  hint,
  label = "Import",
  caption = "Excel, Sheets, Word, PDF, TIFF, CAD",
  disabled,
}: UniversalImportButtonProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    // Hard guard against re-entry — setBusy is async so a fast double-click can fire twice.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (hint) form.append("hint", hint);

      const res = await fetch("/api/parse/document", {
        method: "POST",
        body: form,
      });

      const data = (await res.json().catch(() => ({}))) as Partial<ParseResult> & {
        error?: string;
      };

      if (!res.ok) {
        const message = data?.error || `Import failed (${res.status})`;
        toast({ title: String(message), kind: "info" });
        onParsed({
          kind: "error",
          filename: file.name,
          mime: file.type,
          error: message,
        });
        return;
      }

      onParsed({
        kind: (data.kind as ParseResult["kind"]) || "text",
        filename: data.filename || file.name,
        mime: data.mime || file.type,
        rows: data.rows,
        headers: data.headers,
        text: data.text,
        entities: data.entities,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast({ title: String(message), kind: "info" });
      onParsed({
        kind: "error",
        filename: file.name,
        mime: file.type,
        error: message,
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="group relative inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-xs font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Parsing…" : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        aria-label="Choose file to import"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (busyRef.current) {
            // Reset value so the same file can be re-picked later.
            e.target.value = "";
            return;
          }
          if (file.size === 0) {
            toast({ title: String(`"${file.name}" is empty (0 bytes). Please choose a non-empty file.`), kind: "error" });
            e.target.value = "";
            return;
          }
          void handleFile(file);
        }}
      />
      {caption ? (
        <span className="pointer-events-none mt-1 text-[10px] uppercase tracking-widest text-white/40 opacity-0 transition-opacity group-hover:opacity-100">
          {caption}
        </span>
      ) : null}
    </div>
  );
}

export default UniversalImportButton;
