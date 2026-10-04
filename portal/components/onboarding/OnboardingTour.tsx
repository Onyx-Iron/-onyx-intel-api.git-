"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalProjectContext } from "@/components/project/ProjectContext";
import {
  FIRST_RUN_EVENT,
  firstRunHref,
  firstRunTargetId,
  isFirstRunComplete,
  nextFirstRunStep,
  patchFirstRun,
  readFirstRun,
  type FirstRunFlags,
  type FirstRunStepId,
} from "@/lib/onboarding/firstRun";

const WELCOME_KEY = "onyx_first_run_welcome_v1";

const STEP_COPY: Record<Exclude<FirstRunStepId, "welcome" | "done">, { title: string; body: string; cta: string }> = {
  create_project: {
    title: "Create your first project",
    body: "Work happens inside a project. Give it a name — you can upload plans next.",
    cta: "Create a project",
  },
  upload_plans: {
    title: "Upload a plan PDF",
    body: "Use Upload Plans in the project header. We split pages into Takeoff and search.",
    cta: "Go to Documents",
  },
  open_takeoff: {
    title: "Open Takeoff",
    body: "When pages finish splitting, measure sheets and extract quantities here.",
    cta: "Open Takeoff",
  },
};

export default function OnboardingTour() {
  const router = useRouter();
  const pathname = usePathname();
  const projectCtx = useOptionalProjectContext();
  const hasProject = (projectCtx?.projects.length ?? 0) > 0;
  const projectId = projectCtx?.activeProjectId ?? projectCtx?.projects[0]?.id ?? null;

  const [welcome, setWelcome] = useState(false);
  const [flags, setFlags] = useState<FirstRunFlags>(() => readFirstRun());
  const [highlight, setHighlight] = useState<DOMRect | null>(null);

  const step = nextFirstRunStep(flags, hasProject);
  const done = isFirstRunComplete(flags, hasProject);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(WELCOME_KEY)) setWelcome(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const sync = () => setFlags(readFirstRun());
    window.addEventListener(FIRST_RUN_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FIRST_RUN_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (hasProject && !flags.project_created) {
      setFlags(patchFirstRun({ project_created: true }));
    }
  }, [hasProject, flags.project_created]);

  useEffect(() => {
    if (welcome || done || step === "done") {
      setHighlight(null);
      return;
    }
    const targetId = firstRunTargetId(step);
    if (!targetId) {
      setHighlight(null);
      return;
    }
    const el = document.getElementById(targetId);
    if (!el) {
      setHighlight(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setHighlight(rect);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [welcome, done, step, pathname]);

  function dismissWelcome() {
    try {
      window.localStorage.setItem(WELCOME_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
    setWelcome(false);
  }

  function skipAll() {
    dismissWelcome();
    setFlags(patchFirstRun({ dismissed: true }));
  }

  function goNext() {
    const href = firstRunHref(step, projectId);
    if (href) router.push(href);
  }

  if (welcome) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome"
        className="fixed inset-0 z-[9999] flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={dismissWelcome} />
        <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0E0F12] p-6 shadow-2xl">
          <div className="mb-4 flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#CCFF00] text-lg font-black text-black"
            >
              ⚡
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]">
              OnyxIntel
            </span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">Welcome to Onyx &amp; Iron</h2>
          <p className="mt-3 text-sm leading-relaxed text-white/75">
            Create a project, upload plans, then takeoff and estimate live in that workspace.
            Company tools stay under More tools until you need them.
          </p>
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={skipAll}
              className="text-xs font-bold uppercase tracking-widest text-white/60 transition-colors hover:text-white"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => {
                dismissWelcome();
                if (!hasProject) router.push("/dashboard/projects?new=1");
              }}
              className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
            >
              {hasProject ? "Continue" : "Create a project"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (done || step === "done" || step === "welcome") return null;

  const copy = STEP_COPY[step];

  return (
    <>
      {highlight && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[9998] rounded-xl border-2 border-[#CCFF00] shadow-[0_0_0_4px_rgba(204,255,0,0.18)]"
          style={{
            top: highlight.top - 8,
            left: highlight.left - 8,
            width: highlight.width + 16,
            height: highlight.height + 16,
          }}
        />
      )}
      <div
        role="status"
        className="fixed bottom-4 right-4 z-[9997] w-[min(100%-2rem,22rem)] rounded-2xl border border-white/10 bg-[#0E0F12] p-4 shadow-2xl lg:bottom-6 lg:right-6"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]">Next step</p>
        <h3 className="mt-1 text-sm font-semibold text-white">{copy.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-white/60">{copy.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skipAll}
            className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={goNext}
            className="inline-flex h-8 items-center rounded-full bg-[#CCFF00] px-4 text-[10px] font-bold uppercase tracking-widest text-black"
          >
            {copy.cta}
          </button>
        </div>
      </div>
    </>
  );
}
