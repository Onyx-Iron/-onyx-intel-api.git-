"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LINK_ROLES, RECORD_TYPES, recordHref, type RecordType } from "@/lib/project-file/records";

const INPUT = "w-full bg-[#0A0A0B] border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-[#CCFF00]/40";
const BUTTON = "rounded-lg border border-[#CCFF00]/30 bg-[#CCFF00]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#CCFF00]";

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function ProjectFileBrief({ projectId }: { projectId: string }) {
  const [lines, setLines] = useState<Array<{ text: string; href: string }>>([]);
  useEffect(() => {
    fetch(`/api/project-file/brief?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data: { lines?: Array<{ text: string; href: string }> }) => setLines(data.lines ?? []))
      .catch(() => setLines([]));
  }, [projectId]);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#111113] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">This project file</p>
      <ul className="mt-3 space-y-2">
        {lines.map((line) => (
          <li key={line.text}>
            <Link href={line.href} className="text-xs text-[#00D2FF] hover:underline">{line.text}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecordLinker({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<Array<{ id: string; from_type: string; from_id: string; to_type: string; to_id: string; link_role: string }>>([]);
  const [form, setForm] = useState({ from_type: "rfi", from_id: "", to_type: "schedule_task", to_id: "", link_role: "related" });
  const [ball, setBall] = useState({ kind: "rfi", id: "", ball_contact_id: "", ball_since: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/project-links?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data: { links?: typeof links }) => setLinks(data.links ?? []))
      .catch(() => setLinks([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const addLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/project-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, ...form }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "Could not link records"); return; }
    setForm((current) => ({ ...current, from_id: "", to_id: "" }));
    load();
  };

  const setHolder = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/project-file/ball", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, ...ball }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Could not set the holder");
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Links in this file</p>
      {error && <p className="text-xs text-[#E50914]">{error}</p>}
      <ul className="space-y-1">
        {links.map((link) => (
          <li key={link.id} className="flex items-center justify-between gap-2 text-xs text-white/70">
            <span>
              <Link className="text-[#00D2FF]" href={recordHref(projectId, link.from_type as RecordType)}>{link.from_type}</Link>
              {` ${link.link_role} `}
              <Link className="text-[#00D2FF]" href={recordHref(projectId, link.to_type as RecordType)}>{link.to_type}</Link>
            </span>
            <button type="button" className="text-[10px] uppercase text-white/30" onClick={async () => {
              await fetch(`/api/project-links?project_id=${encodeURIComponent(projectId)}&id=${encodeURIComponent(link.id)}`, { method: "DELETE" });
              load();
            }}>Remove</button>
          </li>
        ))}
        {links.length === 0 && <li className="text-xs text-white/30">No records linked yet.</li>}
      </ul>
      <form onSubmit={addLink} className="grid gap-2 md:grid-cols-5">
        <select className={INPUT} value={form.from_type} onChange={(e) => setForm({ ...form, from_type: e.target.value })}>
          {RECORD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input className={INPUT} placeholder="From id" value={form.from_id} onChange={(e) => setForm({ ...form, from_id: e.target.value })} required />
        <select className={INPUT} value={form.link_role} onChange={(e) => setForm({ ...form, link_role: e.target.value })}>
          {LINK_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <select className={INPUT} value={form.to_type} onChange={(e) => setForm({ ...form, to_type: e.target.value })}>
          {RECORD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input className={INPUT} placeholder="To id" value={form.to_id} onChange={(e) => setForm({ ...form, to_id: e.target.value })} required />
        <button className={BUTTON} type="submit">Link</button>
      </form>
      <form onSubmit={setHolder} className="grid gap-2 md:grid-cols-4">
        <select className={INPUT} value={ball.kind} onChange={(e) => setBall({ ...ball, kind: e.target.value })}>
          <option value="rfi">RFI</option>
          <option value="submittal">Submittal</option>
          <option value="change_order">Change order</option>
          <option value="punch">Punch</option>
        </select>
        <input className={INPUT} placeholder="Record id" value={ball.id} onChange={(e) => setBall({ ...ball, id: e.target.value })} required />
        <input className={INPUT} placeholder="Contact id" value={ball.ball_contact_id} onChange={(e) => setBall({ ...ball, ball_contact_id: e.target.value })} />
        <input className={INPUT} type="date" value={ball.ball_since} onChange={(e) => setBall({ ...ball, ball_since: e.target.value })} />
        <button className={BUTTON} type="submit">Set ball in court</button>
      </form>
      <p className="text-[10px] text-white/30">Pin a record from the sheet canvas. The pin stays on this project and does not create a takeoff.</p>
    </div>
  );
}

export function BudgetTab({ projectId }: { projectId: string }) {
  const [payload, setPayload] = useState<{ lines: Array<Record<string, unknown>>; totals: Record<string, number> | null; unassigned_actual: number | null } | null>(null);
  const [remaining, setRemaining] = useState<Array<{ description: string; remaining: number | null; installed: number }>>([]);
  useEffect(() => {
    fetch(`/api/project-budget?project_id=${encodeURIComponent(projectId)}`).then((res) => res.json()).then(setPayload).catch(() => setPayload(null));
    fetch(`/api/project-file/remaining?project_id=${encodeURIComponent(projectId)}`).then((res) => res.json()).then((data) => setRemaining(data.lines ?? [])).catch(() => setRemaining([]));
  }, [projectId]);
  if (!payload?.lines?.length) {
    return <p className="text-xs text-white/40">No budget snapshot yet. Approve an estimate version, then save it as this project&apos;s budget.</p>;
  }
  const totals = payload.totals;
  return (
    <div className="space-y-4">
      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["Original", totals.original],
            ["Approved changes", totals.approved_change],
            ["Revised", totals.revised],
            ["Committed", totals.committed],
            ["Actual", totals.actual],
            ["Forecast to complete", totals.forecast_to_complete],
            ["Projected final", totals.projected_final],
            ["Projected margin", totals.projected_margin],
          ] as Array<[string, number]>).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-[#111113] p-3">
              <p className="text-lg font-black text-white">{money(value)}</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-white/30">{label}</p>
            </div>
          ))}
        </div>
      )}
      {payload.unassigned_actual != null && payload.unassigned_actual !== 0 && (
        <p className="text-xs text-white/50">Unassigned actuals on this project: {money(payload.unassigned_actual)}</p>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-white/30">
            <th className="py-2">Line</th>
            <th>Remaining qty</th>
            <th>Revised</th>
            <th>Margin</th>
          </tr>
        </thead>
        <tbody>
          {payload.lines.map((line) => {
            const match = remaining.find((row) => row.description === line.description);
            return (
              <tr key={String(line.id)} className="border-t border-white/5 text-white/80">
                <td className="py-2">{String(line.description)}</td>
                <td>{match?.remaining ?? "—"}</td>
                <td>{money(line.revised as number | null)}</td>
                <td>{money(line.projected_margin as number | null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PayAppsTab({ projectId }: { projectId: string }) {
  const [apps, setApps] = useState<Array<{ id: string; number: string | null; side: string; status: string }>>([]);
  const [number, setNumber] = useState("1");
  const [draw, setDraw] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(`/api/pay-applications?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => setApps(data.pay_applications ?? []))
      .catch(() => setApps([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-[#E50914]">{error}</p>}
      <form className="flex flex-wrap gap-2" onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        const res = await fetch("/api/pay-applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, side: "owner", number, draw_number: draw, retainage_pct: 10 }),
        });
        if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error ?? "Could not create pay app"); return; }
        load();
      }}>
        <input className={INPUT} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Number" />
        <input className={INPUT} value={draw} onChange={(e) => setDraw(e.target.value)} placeholder="Draw" />
        <button className={BUTTON} type="submit">Create from SOV</button>
      </form>
      <ul className="space-y-2 text-xs text-white/70">
        {apps.map((app) => (
          <li key={app.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
            <span>#{app.number ?? "—"} · {app.side} · {app.status}</span>
            {app.status === "draft" && (
              <button type="button" className={BUTTON} onClick={async () => {
                setError(null);
                const res = await fetch("/api/pay-applications", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ project_id: projectId, id: app.id, status: "payable" }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) setError(data.error ?? "Pay app stayed draft");
                load();
              }}>Mark payable</button>
            )}
          </li>
        ))}
        {apps.length === 0 && <li className="text-white/30">No pay applications on this project.</li>}
      </ul>
    </div>
  );
}

export function ChangeEventsPanel({ projectId }: { projectId: string }) {
  const [events, setEvents] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [title, setTitle] = useState("");
  const load = useCallback(() => {
    fetch(`/api/change-events?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setEvents([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="rounded-xl border border-white/10 bg-[#0E0F12] p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Change events</p>
      <form className="flex gap-2" onSubmit={async (event) => {
        event.preventDefault();
        await fetch("/api/change-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, title, status: "pending" }),
        });
        setTitle("");
        load();
      }}>
        <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Field condition" required />
        <button className={BUTTON} type="submit">Add</button>
      </form>
      <ul className="space-y-2 text-xs text-white/70">
        {events.map((item) => (
          <li key={item.id} className="flex items-center justify-between">
            <span>{item.title} · {item.status}</span>
            {item.status !== "approved" && item.status !== "void" && (
              <span className="flex gap-2">
                <button type="button" className={BUTTON} onClick={async () => {
                  await fetch(`/api/change-events/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, action: "approve" }) });
                  load();
                }}>Approve</button>
                <button type="button" className="text-[10px] uppercase text-white/40" onClick={async () => {
                  await fetch(`/api/change-events/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, action: "void" }) });
                  load();
                }}>Void</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimeCardsTab({ projectId }: { projectId: string }) {
  const [cards, setCards] = useState<Array<{ id: string; staff_name: string | null; work_date: string; hours: number; status: string }>>([]);
  const [form, setForm] = useState({ staff_member_id: "", work_date: "", hours: "8" });
  const load = useCallback(() => {
    fetch(`/api/time-cards?project_id=${encodeURIComponent(projectId)}`).then((res) => res.json()).then((data) => setCards(data.time_cards ?? [])).catch(() => setCards([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
        event.preventDefault();
        await fetch("/api/time-cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, ...form, hours: Number(form.hours) }) });
        load();
      }}>
        <input className={INPUT} placeholder="Staff id" value={form.staff_member_id} onChange={(e) => setForm({ ...form, staff_member_id: e.target.value })} required />
        <input className={INPUT} type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} required />
        <input className={INPUT} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
        <button className={BUTTON} type="submit">Add time</button>
      </form>
      <ul className="space-y-2 text-xs text-white/70">
        {cards.map((card) => (
          <li key={card.id} className="flex justify-between">
            <span>{card.staff_name ?? "Staff"} · {card.work_date} · {card.hours}h · {card.status}</span>
            {card.status === "draft" && <button type="button" className={BUTTON} onClick={async () => {
              await fetch("/api/time-cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, id: card.id, status: "approved" }) });
              load();
            }}>Approve</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MeetingsTab({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Array<{ id: string; title: string; meeting_date: string }>>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [action, setAction] = useState("");
  const load = useCallback(() => {
    fetch(`/api/meetings?project_id=${encodeURIComponent(projectId)}`).then((res) => res.json()).then((data) => setMeetings(data.meetings ?? [])).catch(() => setMeetings([]));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <form className="grid gap-2 md:grid-cols-4" onSubmit={async (event) => {
        event.preventDefault();
        await fetch("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            title,
            meeting_date: date,
            actions: action ? [{ title: action }] : [],
          }),
        });
        setTitle("");
        setAction("");
        load();
      }}>
        <input className={INPUT} placeholder="Meeting" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className={INPUT} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <input className={INPUT} placeholder="Action item" value={action} onChange={(e) => setAction(e.target.value)} />
        <button className={BUTTON} type="submit">Save</button>
      </form>
      <ul className="text-xs text-white/70 space-y-1">
        {meetings.map((meeting) => <li key={meeting.id}>{meeting.meeting_date} · {meeting.title}</li>)}
      </ul>
    </div>
  );
}

export function CloseoutAssembly({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{
    punch_walk: Array<{ id: string; label: string | null }>;
    closeout_manual: Array<{ id: string; title: string; spec_section: string | null }>;
    warranty: Array<{ id: string; name: string | null; warranty_end_date: string | null; source: string }>;
    inspections: Array<{ id: string; inspection_type: string; status: string }>;
  } | null>(null);
  const [type, setType] = useState("building");
  useEffect(() => {
    fetch(`/api/closeout-assembly?project_id=${encodeURIComponent(projectId)}`).then((res) => res.json()).then(setData).catch(() => setData(null));
  }, [projectId]);
  return (
    <div className="space-y-4 text-xs text-white/70">
      <form className="flex gap-2" onSubmit={async (event) => {
        event.preventDefault();
        await fetch("/api/project-inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, inspection_type: type }) });
        const res = await fetch(`/api/closeout-assembly?project_id=${encodeURIComponent(projectId)}`);
        setData(await res.json());
      }}>
        <input className={INPUT} value={type} onChange={(e) => setType(e.target.value)} />
        <button className={BUTTON} type="submit">Add inspection</button>
      </form>
      <section>
        <p className="text-[10px] uppercase tracking-widest text-white/40">Punch walk</p>
        {(data?.punch_walk ?? []).map((pin) => <p key={pin.id}>{pin.label ?? pin.id}</p>)}
      </section>
      <section>
        <p className="text-[10px] uppercase tracking-widest text-white/40">Closeout manual</p>
        {(data?.closeout_manual ?? []).map((row) => <p key={row.id}>{row.spec_section ?? "—"} · {row.title}</p>)}
      </section>
      <section>
        <p className="text-[10px] uppercase tracking-widest text-white/40">Warranty</p>
        {(data?.warranty ?? []).map((row) => <p key={`${row.source}-${row.id}`}>{row.name} · {row.warranty_end_date ?? "open"}</p>)}
      </section>
      <section>
        <p className="text-[10px] uppercase tracking-widest text-white/40">Inspections</p>
        {(data?.inspections ?? []).map((row) => <p key={row.id}>{row.inspection_type} · {row.status}</p>)}
      </section>
    </div>
  );
}

export function RemainingCivil({ projectId }: { projectId: string }) {
  const [lines, setLines] = useState<Array<{ description: string; remaining: number | null; installed: number }>>([]);
  useEffect(() => {
    fetch(`/api/project-file/remaining?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => setLines(data.civil ?? []))
      .catch(() => setLines([]));
  }, [projectId]);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#111113] p-4 text-xs text-white/70">
      <p className="text-[10px] uppercase tracking-widest text-white/40">Remaining from this file</p>
      {lines.map((line) => (
        <p key={line.description}>{line.description}: {line.remaining ?? "—"} left ({line.installed} installed)</p>
      ))}
    </div>
  );
}

export function SelectionsTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Array<{ id: string; description: string; is_allowance: boolean }>>([]);
  useEffect(() => {
    fetch(`/api/estimate?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => {
        const rows = (data.items ?? data.estimates ?? []) as Array<{ id: string; description: string; is_allowance?: boolean }>;
        setItems(rows.filter((row) => row.is_allowance).map((row) => ({ id: row.id, description: row.description, is_allowance: true })));
      })
      .catch(() => setItems([]));
  }, [projectId]);
  return (
    <div className="text-xs text-white/70 space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-white/40">Allowances on this estimate</p>
      {items.length === 0 && <p>No allowance lines on this project.</p>}
      {items.map((item) => <p key={item.id}>{item.description}</p>)}
    </div>
  );
}
