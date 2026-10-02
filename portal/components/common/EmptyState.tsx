"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: EmptyStateProps) {
  const actionClass =
    "mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[#CCFF00] px-5 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85";

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#CCFF00]/8 text-[#CCFF00] mb-4">
        {icon}
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && (
        <p className="mt-1.5 text-xs text-white/40 max-w-md">{description}</p>
      )}
      {actionLabel && actionHref && (
        <Link href={actionHref} className={actionClass}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button type="button" onClick={onAction} className={actionClass}>
          {actionLabel}
        </button>
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
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle size={14} className="text-[#E50914] shrink-0" />
        <p className="text-[11px] text-[#E50914] font-mono uppercase tracking-widest truncate">
          {message}
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-[10px] text-[#E50914] hover:text-white uppercase tracking-widest font-bold shrink-0"
        >
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </div>
  );
}
