"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useProjectContext } from "@/components/project/ProjectContext";
import { patchFirstRun } from "@/lib/onboarding/firstRun";

export interface NewProjectFields {
  name: string;
  address: string;
  city: string;
  state: string;
  status: string;
  budget: string;
}

const EMPTY: NewProjectFields = {
  name: "",
  address: "",
  city: "",
  state: "",
  status: "active",
  budget: "",
};

export default function NewProjectForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (projectId: string) => void;
}) {
  const router = useRouter();
  const { setActiveProjectId, refreshProjects } = useProjectContext();
  const [form, setForm] = useState<NewProjectFields>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, budget: form.budget ? parseFloat(form.budget) : null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = await res.json() as { project?: { id?: string } };
      const id = created.project?.id;
      if (id) {
        setActiveProjectId(id);
        patchFirstRun({ project_created: true });
        await refreshProjects();
        onCreated?.(id);
        router.push(`/dashboard/projects/${id}?phase=documents&tab=documents`);
        return;
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#111113] p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-semibold text-white">New Project</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[40px] rounded-md p-1 text-white/30 transition-colors hover:text-white"
          aria-label="Close new project form"
        >
          <X size={16} />
        </button>
      </div>
      {error && (
        <p className="mb-4 text-xs text-[#E50914]">{error}</p>
      )}
      <form onSubmit={handleCreate}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(
            [
              { key: "name", label: "Project Name *", placeholder: "Main Street Office Build-Out" },
              { key: "address", label: "Address", placeholder: "123 Main St" },
              { key: "city", label: "City", placeholder: "Dallas" },
              { key: "state", label: "State", placeholder: "TX" },
              { key: "budget", label: "Budget ($)", placeholder: "0.00" },
            ] as { key: keyof NewProjectFields; label: string; placeholder: string }[]
          ).map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-white/40">{label}</label>
              <input
                type={key === "budget" ? "number" : "text"}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                required={key === "name"}
                className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-[#CCFF00]/40"
              />
            </div>
          ))}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-white/40">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="h-10 w-full rounded-lg border border-white/10 bg-[#111113] px-3 text-sm text-white outline-none focus:border-[#CCFF00]/40"
            >
              <option value="active">Active</option>
              <option value="bidding">Bidding</option>
              <option value="on_hold">On Hold</option>
              <option value="complete">Complete</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#CCFF00] px-4 text-sm font-bold text-black disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Project"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-4 text-sm text-white/40 transition-colors hover:text-white"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
