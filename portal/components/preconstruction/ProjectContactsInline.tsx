"use client";

import { useEffect, useState } from "react";

interface ProjectContactRow {
  id: string;
  contact_id: string;
  role_on_project: string | null;
  is_primary: boolean;
}

export default function ProjectContactsInline({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ProjectContactRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/project-contacts?project_id=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = await res.json() as { project_contacts?: ProjectContactRow[] };
      if (!cancelled) setRows(data.project_contacts ?? []);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (rows.length === 0) return null;
  return (
    <p className="mt-1 text-[10px] text-white/35">
      Contacts: {rows.length}
      {rows.some((r) => r.is_primary) ? " · primary set" : ""}
      {rows[0]?.role_on_project ? ` · ${rows[0].role_on_project}` : ""}
    </p>
  );
}
