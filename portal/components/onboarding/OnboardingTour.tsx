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
    body: "Your workspace for construction and real estate. Plans, daily logs, estimates, and reports all live together in one place.",
  },
  {
    title: "Create your first project",
    body: "Start by creating a project. That gives every plan, budget, report, and task a home.",
    targetId: "new-project-button",
  },
  {
    title: "Upload plans",
    body: "Upload PDFs or images from the project page. The app extracts scope, takeoffs, and key details automatically.",
    targetId: "upload-plans-pill",
  },
  {
    title: "Make reports",
    body: "Use the document menu to create daily logs, RFIs, change orders, and field reports.",
    targetId: "generate-document-dropdown",
  },
  {
    title: "All in one workspace",
    body: "Move between Preconstruction, Construction, Closeout, Operations, and Intelligence without leaving your project.",
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
      if (!done) {
        const timer = window.setTimeout(() => {
          setOpen(true);
        }, 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      const timer = window.setTimeout(() => {
        setOpen(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      const timer = window.setTimeout(() => {
        setHighlight(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const current = STEPS[step];
    if (!current?.targetId) {
      const timer = window.setTimeout(() => {
        setHighlight(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const el = document.getElementById(current.targetId);
    if (!el) {
      const timer = window.setTimeout(() => {
        setHighlight(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const rect = el.getBoundingClientRect();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => {
      setHighlight(rect);
    }, 0);
    return () => window.clearTimeout(timer);
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
        Skip
      </button>

      {/* Card */}
      <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0E0F12] p-6 shadow-2xl">
        {isFirst && (
          <div className="mb-4 flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#CCFF00] text-lg font-black text-black"
            >
              ?
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
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
