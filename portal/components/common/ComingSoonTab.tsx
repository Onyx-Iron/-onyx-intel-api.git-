import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

interface ComingSoonTabProps {
  title: string;
  description: string;
  willInclude?: string[];
  icon?: ReactNode;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export default function ComingSoonTab({
  title,
  description,
  willInclude,
  icon,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
}: ComingSoonTabProps) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#0E0F12] p-8 sm:p-12">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#CCFF00]/20 bg-[#CCFF00]/8 text-[#CCFF00]">
          {icon ?? <Sparkles size={20} />}
        </div>
        <p className="mt-5 text-[9px] font-bold uppercase tracking-[0.22em] text-[#CCFF00]/70">Planned feature</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/55">{description}</p>
        {willInclude && willInclude.length > 0 && (
          <div className="mt-7 inline-flex flex-col items-start gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-5 text-left">
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/45">What it will do</p>
            <ul className="mt-1 space-y-1.5 text-sm text-white/65">
              {willInclude.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#CCFF00]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(primaryHref || secondaryHref) && (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {primaryHref && (
              <Link
                href={primaryHref}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-[#CCFF00] px-4 text-[10px] font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
              >
                {primaryLabel ?? "Go there"}
              </Link>
            )}
            {secondaryHref && (
              <Link
                href={secondaryHref}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-4 text-[10px] font-bold uppercase tracking-widest text-white/70 transition-colors hover:border-white/30 hover:text-white"
              >
                {secondaryLabel ?? "Back"}
              </Link>
            )}
          </div>
        )}
        {!primaryHref && !secondaryHref && (
          <p className="mt-7 text-[10px] uppercase tracking-widest text-white/30">
            Check Projects, Documents, or Command Center for the live workflow in the meantime.
          </p>
        )}
      </div>
    </div>
  );
}
