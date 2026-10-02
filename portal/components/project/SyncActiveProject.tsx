"use client";

import { useEffect } from "react";
import { useProjectContext } from "./ProjectContext";

/** When visiting a project detail page, lock the shared active project to it. */
export default function SyncActiveProject({
  projectId,
}: {
  projectId: string;
  projectName?: string;
  status?: string | null;
}) {
  const { setActiveProjectId } = useProjectContext();

  useEffect(() => {
    setActiveProjectId(projectId);
  }, [projectId, setActiveProjectId]);

  return null;
}
