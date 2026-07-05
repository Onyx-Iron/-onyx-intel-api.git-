import React, { type ReactNode } from "react";

interface PageHeroProps {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
}

export default function PageHero({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
  children,
}: PageHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-white/5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 75% 10%, rgba(204,255,0,0.10) 0%, transparent 45%), radial-gradient(90% 70% at 90% 60%, rgba(0,210,180,0.06) 0%, transparent 50%), linear-gradient(180deg, #06070A 0%, #08090C 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[6%] top-[10%] hidden h-[80%] w-[5px] origin-bottom -rotate-12 bg-[#CCFF00] md:block"
      />

      <div className={`relative ${compact ? "px-4 pb-6 pt-5 lg:px-10 lg:pb-8 lg:pt-6" : "px-4 pb-8 pt-5 lg:px-10 lg:pb-14 lg:pt-8"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">{eyebrow}</p>
            )}
            <h1 className={`font-black tracking-tight text-white ${compact ? "text-3xl sm:text-4xl" : "text-[32px] leading-[1.05] sm:text-5xl lg:text-6xl"}`}>
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-sm text-white/45 sm:mt-3">{description}</p>
            )}
          </div>
          {actions && (
            <div className="shrink-0">{actions}</div>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
