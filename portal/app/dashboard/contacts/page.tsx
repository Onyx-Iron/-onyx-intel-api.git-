"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import PageHero from "@/components/layout/PageHero";
import EmptyState, { ErrorState } from "@/components/common/EmptyState";
import ProjectScopeSelect, { filterByActiveProject } from "@/components/project/ProjectScopeSelect";
import { useProjectContext } from "@/components/project/ProjectContext";
import { chooseOrCreateProjectHref } from "@/lib/navigation/project-sections";

import { useConfirm } from "@/components/common/ConfirmDialog";

interface Contact {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  project_id: string | null;
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

const INPUT_CLASS =
  "bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00]/40 focus:border-[#CCFF00]/40 transition-colors w-full";

const LABEL_CLASS = "text-[10px] uppercase tracking-widest text-gray-600 mb-1.5 block";

function SkeletonRows() {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <tr key={i}>
          {[...Array(6)].map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div
                className="h-3 bg-white/5 animate-pulse rounded"
                style={{ width: j === 0 ? "60%" : "45%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function ContactsPage() {
  const { confirm } = useConfirm();
  const { activeProjectId, activeProject } = useProjectContext();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = () => {
    setLoading(true);
    setError(null);
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { contacts?: Contact[] };
        setContacts(data.contacts ?? []);
        setLoading(false);
      })
      .catch((e) => { setError(e?.message ?? "Network error"); setLoading(false); });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadContacts(); }, []);

  const filteredContacts = useMemo(
    () => filterByActiveProject(contacts, activeProjectId),
    [contacts, activeProjectId],
  );

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
    if (!form.name.trim()) return;
    setSubmitting(true);
    const payload = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      role: form.role.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      ...(activeProjectId && !editId ? { project_id: activeProjectId } : {}),
    };
    try {
      if (editId) {
        await fetch(`/api/contacts/${encodeURIComponent(editId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      cancelForm();
      loadContacts();
    } finally {
      setSubmitting(false);
    }
  };

  const deleteContact = async (id: string) => {
    if (!(await confirm({ title: String("Delete this contact?"), destructive: true }))) return;
    setContacts((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/contacts/${encodeURIComponent(id)}`, { method: "DELETE" })
      .catch(() => loadContacts());
  };

  return (
    <div>
      <PageHero
        eyebrow="Workspace"
        title="Contacts"
        description={
          activeProject
            ? `Contacts linked to ${activeProject.name}`
            : "All team members, subs, and vendors"
        }
        compact
        actions={
          <button
            onClick={openAdd}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#CCFF00] px-4 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
          >
            Add Contact
          </button>
        }
      />

      <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      {error && <div className="mb-4"><ErrorState message={error} onRetry={loadContacts} /></div>}
      <div className="mb-4 flex justify-end">
        <ProjectScopeSelect className="w-56" label="" />
      </div>
      <div className="rounded-xl border border-white/8 bg-[#0E0F12] overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#0A0A0B] border-b border-white/10">
              <tr>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Name</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Company</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Role</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Email</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Phone</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-gray-600 font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <SkeletonRows />
              ) : filteredContacts.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="py-4">
                      <EmptyState
                        icon={<Users className="w-6 h-6" />}
                        title="No contacts yet"
                        description={
                          activeProject
                            ? `Contacts for ${activeProject.name} start here — add a sub, vendor, or stakeholder.`
                            : "Contacts live with a project. Choose or create one, then add people."
                        }
                        actionLabel={activeProject ? "Add Contact" : "Choose or create a project"}
                        onAction={activeProject ? openAdd : undefined}
                        actionHref={activeProject ? undefined : chooseOrCreateProjectHref(null, "overview", "summary")}
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                filteredContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-white text-xs font-medium">{contact.name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{contact.company || "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{contact.role || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {contact.email
                        ? <a href={`mailto:${contact.email}`} className="text-[#00D2FF] hover:underline">{contact.email}</a>
                        : <span className="text-gray-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{contact.phone || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(contact)}
                          className="text-gray-600 hover:text-white transition-colors min-h-[40px]"
                          title="Edit"
                          aria-label={`Edit contact ${contact.name}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteContact(contact.id)}
                          className="text-gray-600 hover:text-[#E50914] transition-colors min-h-[40px]"
                          title="Delete"
                          aria-label={`Delete contact ${contact.name}`}
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

      {/* Form panel */}
      {showForm && (
        <div className="rounded-xl border border-white/10 bg-[#16161A] p-6">
          <h3 className="text-[11px] uppercase tracking-widest text-gray-400 mb-4">
            {editId ? "Edit Contact" : "New Contact"}
          </h3>
          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Company</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Role</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="e.g. Project Manager, Electrician"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="(555) 000-0000"
                />
              </div>
              <div className="md:col-span-2">
                <label className={LABEL_CLASS}>Notes</label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={`${INPUT_CLASS} resize-none`}
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
    </div>
  );
}
