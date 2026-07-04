"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface MemberRow {
  id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
}

interface Props {
  initialMembers: MemberRow[];
  isAdmin: boolean;
  atLimit: boolean;
}

export default function TeamManager({
  initialMembers,
  isAdmin,
  atLimit,
}: Props) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"basic_member" | "admin">("basic_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invite failed");
        return;
      }
      setSuccess(`Invitation sent to ${email}`);
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(membershipId: string) {
    if (!confirm("Remove this teammate from the workspace?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Remove failed");
        return;
      }
      setMembers((m) => m.filter((x) => x.id !== membershipId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isAdmin && (
        <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
            Invite Teammate
          </p>
          <form
            onSubmit={invite}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest text-white/60">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#06070A] px-3 py-2 text-sm text-white outline-none focus:border-[#CCFF00]/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-white/60">
                Role
              </label>
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "basic_member" | "admin")
                }
                className="mt-1 rounded-lg border border-white/10 bg-[#06070A] px-3 py-2 text-sm text-white outline-none focus:border-[#CCFF00]/50"
              >
                <option value="basic_member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={busy || atLimit}
              className="inline-flex h-10 items-center rounded-full bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {busy ? "Sending..." : "Send Invite"}
            </button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-red-300">{error}</p>
          )}
          {success && (
            <p className="mt-3 text-sm text-emerald-300">{success}</p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-white/8 bg-[#0E0F12] p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
          Current Members
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-white/45">
                <th className="py-2 pr-4 font-bold">Name</th>
                <th className="py-2 pr-4 font-bold">Email</th>
                <th className="py-2 pr-4 font-bold">Role</th>
                <th className="py-2 pr-4 font-bold">Joined</th>
                {isAdmin && <th className="py-2 font-bold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 5 : 4}
                    className="py-6 text-center text-white/50"
                  >
                    No members yet.
                  </td>
                </tr>
              )}
              {members.map((m) => (
                <tr key={m.id} className="border-b border-white/5">
                  <td className="py-3 pr-4 text-white">{m.name}</td>
                  <td className="py-3 pr-4 text-white/70">{m.email}</td>
                  <td className="py-3 pr-4">
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/75">
                      {m.role.replace("org:", "")}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-white/60">
                    {new Date(m.joined_at).toLocaleDateString()}
                  </td>
                  {isAdmin && (
                    <td className="py-3">
                      <button
                        onClick={() => remove(m.id)}
                        disabled={busy}
                        className="rounded-full border border-red-500/30 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
