"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "onyx_tour_completed_v1";

interface Step {
  title: string;
  body: string;
  targetId?: string;
}

const STEPS: Step[] = [
  {
    title: "Welcome to OnyxIntel",
    body: "Your AI command center for construction and real estate. Plans, daily logs, estimates, and reports — unified in one place built for builders.",
  },
  {
    title: "Create your first project",
    body: "Spin up a project to anchor every plan, budget, and report. Click the New Project button to get started.",
    targetId: "new-project-button",
  },
  {
    title: "Upload plans",
    body: "Drop PDFs or images into Upload Plans. We extract scope, takeoffs, and key details automatically.",
    targetId: "upload-plans-pill",
  },
  {
    title: "Generate AI reports",
    body: "Use the Generate Document dropdown to produce daily logs, RFIs, change orders, and field reports in seconds.",
    targetId: "generate-document-dropdown",
  },
  {
    title: "All in one workspace",
    body: "Switch between the five phases — Preconstruction, Construction, Closeout, Operations, and Intelligence — without ever leaving your project.",
    targetId: "phase-tabs",
  },
];

export default function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [highlight, setHighlight] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const done = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!done) setOpen(true);
    } catch {
      // localStorage blocked — skip tour silently.
    }
  }, []);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlight(null);
      return;
    }
    const current = STEPS[step];
    if (!current?.targetId) {
      setHighlight(null);
      return;
    }
    const el = document.getElementById(current.targetId);
    if (!el) {
      setHighlight(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setHighlight(rect);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [step, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        try {
          window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
        } catch {
          // ignore
        }
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function complete() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
    setOpen(false);
  }

  function next() {
    if (step >= STEPS.length - 1) {
      complete();
      return;
    }
    setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding tour"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={complete}
      />

      {/* Highlight rectangle */}
      {highlight && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl border-2 border-[#CCFF00] shadow-[0_0_0_4px_rgba(204,255,0,0.18),0_0_40px_rgba(204,255,0,0.45)] transition-all duration-300"
          style={{
            top: highlight.top - 8,
            left: highlight.left - 8,
            width: highlight.width + 16,
            height: highlight.height + 16,
          }}
        />
      )}

      {/* Skip link */}
      <button
        onClick={complete}
        className="absolute right-5 top-5 z-10 text-xs font-bold uppercase tracking-widest text-white/60 transition-colors hover:text-white"
      >
        Skip tour
      </button>

      {/* Card */}
      <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0E0F12] p-6 shadow-2xl">
        {isFirst && (
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
        )}

        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
          {current.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/75">
          {current.body}
        </p>

        {/* Progress dots */}
        <div className="mt-5 flex gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i <= step ? "bg-[#CCFF00]" : "bg-white/10"
              }`}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={back}
            disabled={isFirst}
            className="text-xs font-bold uppercase tracking-widest text-white/60 transition-colors hover:text-white disabled:opacity-30"
          >
            Back
          </button>
          <button
            onClick={next}
            className="inline-flex h-9 items-center rounded-full bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
          >
            {isLast ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
