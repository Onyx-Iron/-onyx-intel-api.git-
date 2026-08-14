"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  secondaryLabel,
  secondaryHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#CCFF00]/8 text-[#CCFF00] mb-4">
        {icon}
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && (
        <p className="mt-1.5 text-xs text-white/40 max-w-md">{description}</p>
      )}
      {(actionLabel && (onAction || actionHref)) || (secondaryLabel && secondaryHref) ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && (onAction || actionHref) && (
            actionHref ? (
              <Link
                href={actionHref}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
              >
                {actionLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onAction}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
              >
                {actionLabel}
              </button>
            )
          )}
          {secondaryLabel && secondaryHref && (
            <Link
              href={secondaryHref}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 text-xs font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white"
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
      ) : (
        <p className="mt-5 max-w-md text-[10px] uppercase tracking-widest text-white/25">
          Start from Projects, Documents, or Command Center if you are not sure where to go next.
        </p>
      )}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-xl border border-[#E50914]/30 bg-[#E50914]/[0.06] px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-[#E50914]" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white">Something needs attention</p>
          <p className="mt-0.5 text-[11px] text-[#E50914] font-mono uppercase tracking-widest break-words">
            {message}
          </p>
          <p className="mt-1 text-[10px] text-white/40">Try again after a moment, or reload if the page still looks stuck.</p>
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E50914]/20 bg-[#E50914]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#E50914] hover:border-[#E50914]/30 hover:bg-[#E50914]/15 hover:text-white"
        >
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </div>
  );
}
