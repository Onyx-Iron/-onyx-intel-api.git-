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
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);

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
        setError(data.error ?? "Invite failed. Check the email address, your member limit, and your admin access, then try again.");
        return;
      }
      setSuccess(`Invitation sent to ${email}`);
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed. Check the email address, your member limit, and your admin access, then try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(membershipId: string) {
    setBusy(true);
    setError(null);
    const prevMembers = members;
    try {
      const res = await fetch("/api/team/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_id: membershipId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMembers(prevMembers);
        setError(data.error ?? "Remove failed. Refresh and try again, or check whether the teammate is already gone.");
        return false;
      }
      setMembers((m) => m.filter((x) => x.id !== membershipId));
      router.refresh();
      return true;
    } catch (err) {
      setMembers(prevMembers);
      setError(err instanceof Error ? err.message : "Remove failed. Refresh and try again, or check whether the teammate is already gone.");
      return false;
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
          {atLimit && (
            <p className="mt-3 text-sm text-amber-300">
              You&apos;ve reached the current member limit. Remove a member or upgrade the plan to invite more teammates.
            </p>
          )}
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
                    No members yet. Invite the first teammate above to get the workspace moving.
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
                        onClick={() => setRemoveTarget(m)}
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
      {removeTarget && (
          <ConfirmRemoveModal
          busy={busy}
          member={removeTarget}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={async () => {
            const ok = await remove(removeTarget.id);
            if (ok) setRemoveTarget(null);
            return ok;
          }}
        />
      )}
    </>
  );
}

function ConfirmRemoveModal({
  busy,
  member,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  member: MemberRow;
  onCancel: () => void;
  onConfirm: () => boolean | Promise<boolean>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0E0F12] p-5 shadow-2xl">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white">Remove teammate?</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          {member.email} will lose access to the workspace until they’re invited again.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-[11px] font-semibold uppercase tracking-widest text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full bg-red-500 px-4 text-[11px] font-bold uppercase tracking-widest text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
