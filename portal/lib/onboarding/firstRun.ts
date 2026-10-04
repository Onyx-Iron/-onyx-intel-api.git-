/**
 * First-run checklist for new tenants. Stored in localStorage so the coach
 * can follow the user across Home → Projects → Documents → Takeoff.
 */

export const FIRST_RUN_STORAGE_KEY = "onyx_first_run_v1";
export const FIRST_RUN_EVENT = "onyx:first-run";

export type FirstRunFlags = {
  project_created: boolean;
  plans_uploaded: boolean;
  takeoff_opened: boolean;
  dismissed: boolean;
};

export type FirstRunStepId =
  | "welcome"
  | "create_project"
  | "upload_plans"
  | "open_takeoff"
  | "done";

export function emptyFirstRun(): FirstRunFlags {
  return {
    project_created: false,
    plans_uploaded: false,
    takeoff_opened: false,
    dismissed: false,
  };
}

export function parseFirstRun(raw: string | null | undefined): FirstRunFlags {
  const base = emptyFirstRun();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<FirstRunFlags>;
    return {
      project_created: Boolean(parsed.project_created),
      plans_uploaded: Boolean(parsed.plans_uploaded),
      takeoff_opened: Boolean(parsed.takeoff_opened),
      dismissed: Boolean(parsed.dismissed),
    };
  } catch {
    return base;
  }
}

export function readFirstRun(): FirstRunFlags {
  if (typeof window === "undefined") return emptyFirstRun();
  try {
    return parseFirstRun(window.localStorage.getItem(FIRST_RUN_STORAGE_KEY));
  } catch {
    return emptyFirstRun();
  }
}

export function writeFirstRun(flags: FirstRunFlags): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, JSON.stringify(flags));
    window.dispatchEvent(new CustomEvent(FIRST_RUN_EVENT, { detail: flags }));
  } catch {
    // quota / private mode
  }
}

export function patchFirstRun(patch: Partial<FirstRunFlags>): FirstRunFlags {
  const next = { ...readFirstRun(), ...patch };
  writeFirstRun(next);
  return next;
}

/**
 * Next incomplete step. `hasProject` covers projects created in another
 * session before this checklist existed.
 */
export function nextFirstRunStep(flags: FirstRunFlags, hasProject: boolean): FirstRunStepId {
  if (flags.dismissed) return "done";
  if (!hasProject && !flags.project_created) return "create_project";
  if (!flags.plans_uploaded) return "upload_plans";
  if (!flags.takeoff_opened) return "open_takeoff";
  return "done";
}

export function firstRunHref(step: FirstRunStepId, projectId: string | null): string | null {
  switch (step) {
    case "create_project":
      return "/dashboard/projects?new=1";
    case "upload_plans":
      return projectId
        ? `/dashboard/projects/${projectId}?phase=documents&tab=documents`
        : "/dashboard/projects?new=1";
    case "open_takeoff":
      return projectId
        ? `/dashboard/projects/${projectId}?phase=takeoff&tab=takeoff`
        : "/dashboard/projects";
    default:
      return null;
  }
}

export function firstRunTargetId(step: FirstRunStepId): string | undefined {
  switch (step) {
    case "create_project":
      return "new-project-button";
    case "upload_plans":
      return "upload-plans-pill";
    case "open_takeoff":
      return "phase-tabs";
    default:
      return undefined;
  }
}

export function isFirstRunComplete(flags: FirstRunFlags, hasProject: boolean): boolean {
  return nextFirstRunStep(flags, hasProject) === "done";
}
