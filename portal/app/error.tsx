"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[OnyxIntel] Unhandled error boundary:", error);
  }, [error]);

  return (
    <div className="min-h-screen w-full bg-[#06070A] text-white">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.32em] text-[#CCFF00]">
          App paused
        </p>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-5xl">
          We hit a snag loading this page.
        </h1>
        <p className="mt-4 max-w-lg text-sm text-white/60">
          Try the action again. If it keeps happening, refresh the page or head
          back to the dashboard and continue from there.
        </p>
        {error?.message ? (
          <pre className="mt-6 max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-[11px] leading-relaxed text-white/55">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#CCFF00] px-6 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-6 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:border-white/30"
          >
            Reload
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-6 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:border-white/30"
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/projects"
            className="inline-flex h-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-6 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:border-white/30"
          >
            Projects
          </Link>
        </div>
      </div>
    </div>
  );
}
