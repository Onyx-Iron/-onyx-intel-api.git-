"use client";

import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";

interface GeneratedDocResult {
  id: string;
  title: string;
  doc_type: string;
}

const AUTOPILOT_DOC_TYPES = [
  { key: "project_update", label: "Project update" },
  { key: "risk_assessment", label: "Risk assessment" },
  { key: "spec_materials", label: "Spec material list" },
] as const;

export default function ProjectAutopilotButton({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running) return;
    if (!projectId) {
      toast({
        title: "Pick a project first",
        description: "Project summary needs a project context before it can run.",
        kind: "warning",
      });
      return;
    }
    setRunning(true);
    try {
      const results: GeneratedDocResult[] = [];
      for (const docType of AUTOPILOT_DOC_TYPES) {
        const res = await fetch("/api/generated-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            doc_type: docType.key,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          doc?: GeneratedDocResult;
          error?: string;
          code?: string;
        };
        if (!res.ok || !body.doc) {
          if (body.code === "NO_PROVIDER" || res.status === 503) {
            throw new Error("No AI provider is configured for generated documents. Open billing settings, connect a provider, and try again.");
          }
          throw new Error(body.error ?? `Could not generate ${docType.label} (${res.status}). Try again in a moment.`);
        }
        results.push(body.doc);
      }

      toast({
        title: "Project summary created",
        kind: "success",
      });
    } catch (err) {
      toast({
        title: `Summary failed: ${err instanceof Error ? err.message : String(err)}`,
        kind: "error",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={running}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-[#CCFF00]/20 bg-[#CCFF00]/10 px-4 text-xs font-bold uppercase tracking-widest text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/15 disabled:opacity-50"
      title="Create the project summary, risk check, and material list"
    >
      {running ? <Wand2 size={13} className="animate-pulse" /> : <Sparkles size={13} />}
      {running ? "Running..." : "Create project summary"}
    </button>
  );
}
