"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectSyncRefresh } from "@/components/project/ProjectSyncProvider";
import { Users, Sparkles } from "lucide-react";

import { useToast } from "@/components/common/Toast";
import { useConfirm } from "@/components/common/ConfirmDialog";
import EmptyState from "@/components/common/EmptyState";

interface ParsedContact { name: string; company: string; role: string; email: string; phone: string; }

interface Contact {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

interface FormState {
  name: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  company: "",
  role: "",
  email: "",
  phone: "",
  notes: "",
};

function SkeletonRows() {
  return (
    <>
      {[...Array(3)].map((_, i) => (
        <tr key={i}>
          {[...Array(6)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-white/5 animate-pulse rounded" style={{ width: j === 0 ? "60%" : "45%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function ContactsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // AI parse-from-text state
  const [showParse, setShowParse] = useState(false);
  const [parseText, setParseText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedContact[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [savingParsed, setSavingParsed] = useState(false);

  const runParse = async () => {
    if (!parseText.trim() || parsing) return;
    setParsing(true);
    setParsed(null);
    try {
      const res = await fetch("/api/contacts/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: parseText }),
      });
      const d = await res.json() as { contacts?: ParsedContact[]; error?: string; code?: string };
      if (res.ok) {
        setParsed(d.contacts ?? []);
        setSelected(new Set((d.contacts ?? []).map((_, i) => i)));
      } else if (d.code === "NO_PROVIDER") {
        toast({ title: String("No AI model connected. Check GEMINI_API_KEY in Vercel."), kind: "info" });
      } else {
        toast({ title: String(`Could not read those contacts yet. ${d.error ?? `HTTP ${res.status}`}`), kind: "error" });
      }
    } catch {
      // Fix: was swallowing network errors silently
      toast({ title: String("Could not read the import file. Try another file or check the export format."), kind: "error" });
    } finally {
      setParsing(false);
    }
  };

  const addSelected = async () => {
    if (!parsed || savingParsed) return;
    setSavingParsed(true);
    try {
      const toAdd = parsed.filter((_, i) => selected.has(i));
      let failed = 0;
      for (const c of toAdd) {
        try {
          const res = await fetch("/api/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_id: projectId,
              name: c.name || c.company || "Unknown",
              company: c.company || null,
              role: c.role || null,
              email: c.email || null,
              phone: c.phone || null,
              notes: "Parsed from document",
            }),
          });
          if (!res.ok) failed++;
        } catch {
          failed++;
        }
      }
      // Fix: surface partial failures instead of silent loss
      if (failed > 0) toast({ title: String(`${failed} of ${toAdd.length} contact(s) could not be saved.`), kind: "error" });
      setShowParse(false); setParseText(""); setParsed(null); setSelected(new Set());
      loadContacts();
    } finally {
      setSavingParsed(false);
    }
  };

  const loadContacts = useCallback(() => {
    setLoading(true);
    fetch(`/api/contacts?project_id=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { contacts?: Contact[] };
        setContacts(data.contacts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  useProjectSyncRefresh(loadContacts);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (contact: Contact) => {
    setEditId(contact.id);
    setForm({
      name: contact.name,
      company: contact.company ?? "",
      role: contact.role ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      notes: contact.notes ?? "",
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // Fix: guard against double-submit race
    if (!form.name.trim()) { toast({ title: String("Name is required."), kind: "error" }); return; }
    setSubmitting(true);
    const payload = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      role: form.role.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      project_id: projectId,
    };
    try {
      const res = editId
        ? await fetch(`/api/contacts/${encodeURIComponent(editId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        // Fix: was silently closing the form on save failure
        const d = await res.json().catch(() => ({}));
        toast({ title: String(`Could not save this contact: ${(d as { error?: string })?.error ?? `HTTP ${res.status}`}`), kind: "error" });
        return;
      }
      cancelForm();
      loadContacts();
    } catch {
      toast({ title: String("Could not save this contact just now. Please try again in a moment."), kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteContact = async (id: string) => {
    if (!(await confirm({ title: String("Delete this contact?"), destructive: true }))) return;
    // Fix: optimistic-delete now rolls back on non-OK response, not just network errors
    const snapshot = contacts;
    setContacts((prev) => prev.filter((c) => c.id !== id));
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        setContacts(snapshot);
        toast({ title: String(`Could not delete that contact (${res.status}). Refresh the list and try again.`), kind: "error" });
      }
    } catch {
      setContacts(snapshot);
      toast({ title: String("Could not delete that contact just now. Refresh the list and try again in a moment."), kind: "error" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Panel */}
      <div className="rounded-xl border border-white/10 bg-[#0E0F12] hover:border-white/20 transition-colors overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Users size={12} className="text-[#00D2FF]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Contacts</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowParse((v) => !v); setShowForm(false); }}
              className="flex items-center gap-1.5 bg-[#00D2FF]/10 border border-[#00D2FF]/30 text-[#00D2FF] hover:bg-[#00D2FF]/20 rounded-lg px-3 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              <Sparkles size={11} /> Parse from Text
            </button>
            <button
              onClick={openAdd}
              className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors"
            >
              Add Contact
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0A0A0B] border-b border-white/10">
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Name</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Company</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Role</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Email</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-left">Phone</th>
                <th className="text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows />
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="py-4">
                      <EmptyState
                        icon={<Users className="w-6 h-6" />}
                        title="No contacts yet"
                        description="Add subs, vendors, inspectors, and project stakeholders so they’re ready to reuse across the app."
                        actionLabel="Add Contact"
                        onAction={openAdd}
                        secondaryLabel="View projects"
                        secondaryHref="/dashboard/projects"
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-white text-xs font-medium">{contact.name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{contact.company || "-"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{contact.role || "-"}</td>
                    <td className="px-4 py-3 text-xs">
                      {contact.email
                        ? <a href={`mailto:${contact.email}`} className="text-[#00D2FF] hover:underline">{contact.email}</a>
                        : <span className="text-gray-600">-</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{contact.phone || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEdit(contact)}
                          aria-label="Edit contact"
                          className="w-3.5 h-3.5 min-h-[40px] text-gray-600 hover:text-white transition-colors"
                          title="Edit"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteContact(contact.id)}
                          aria-label="Delete contact"
                          className="w-3.5 h-3.5 min-h-[40px] text-gray-600 hover:text-[#E50914] transition-colors"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Parse from Text */}
      {showParse && (
        <div className="rounded-xl border border-[#00D2FF]/20 bg-[#0E0F12] p-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={12} className="text-[#00D2FF]" />
            <span className="text-[11px] uppercase tracking-widest text-gray-400">Paste text to find contacts</span>
          </div>
          <p className="text-[11px] text-gray-600 mb-3">
            Paste a spec cover sheet, email signature block, project directory, or contact list. The app will pull out likely contacts for you to review before saving.
          </p>
          <textarea
            value={parseText}
            onChange={(e) => setParseText(e.target.value)}
            rows={5}
            className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus:border-[#00D2FF]/40 transition-colors"
            placeholder="Paste document text with names, companies, emails, or phone numbers..."
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={runParse}
              disabled={!parseText.trim() || parsing}
              className="flex items-center gap-1.5 bg-[#00D2FF]/10 border border-[#00D2FF]/30 text-[#00D2FF] hover:bg-[#00D2FF]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
            >
              <Sparkles size={12} /> {parsing ? "Extracting..." : "Extract Contacts"}
            </button>
            <button
              onClick={() => { setShowParse(false); setParsed(null); setParseText(""); }}
              className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors"
            >
              Cancel
            </button>
          </div>

          {parsed && (
            <div className="mt-4">
              {parsed.length === 0 ? (
                <p className="text-xs text-gray-600 uppercase tracking-widest">No contacts found yet. Try a longer snippet, a directory page, or a signature block with names and emails.</p>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">{parsed.length} found - select to add</p>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {parsed.map((c, i) => (
                      <label key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0A0A0B] border border-white/5 cursor-pointer hover:border-white/15 transition-colors">
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(i); else n.delete(i); return n; })}
                          className="w-4 h-4 rounded accent-[#00D2FF]"
                        />
                        <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <span className="text-white font-medium truncate">{c.name || "-"}</span>
                          <span className="text-gray-400 truncate">{c.company || "-"}</span>
                          <span className="text-gray-500 truncate">{c.role || "-"}</span>
                          <span className="text-[#00D2FF] truncate">{c.email || c.phone || "-"}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={addSelected}
                    disabled={selected.size === 0 || savingParsed}
                    className="mt-3 bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
                  >
                    {savingParsed ? "Saving..." : `Add ${selected.size} Contact${selected.size !== 1 ? "s" : ""}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">
            {editId ? "Edit Contact" : "New Contact"}
          </p>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Company</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Role</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                  placeholder="e.g. Project Manager, Electrician"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors"
                  placeholder="(555) 000-0000"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Notes</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors resize-none"
                  placeholder="License numbers, specialties, contact preferences..."
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-[#CCFF00]/10 border border-[#CCFF00]/30 text-[#CCFF00] hover:bg-[#CCFF00]/20 rounded-lg px-4 py-2 text-[11px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
              >
                {submitting ? "Saving..." : editId ? "Save Changes" : "Add Contact"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 rounded-lg px-4 py-2 text-[11px] uppercase tracking-widest transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
