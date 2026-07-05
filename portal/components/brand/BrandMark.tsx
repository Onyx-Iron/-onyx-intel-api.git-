import React from "react";

interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
}

export function OILogo({ className = "h-12 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 90" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <text x="62" y="14" fontFamily="Georgia, serif" fontSize="14" fontWeight="900" fill="white">&amp;</text>
      <circle cx="22" cy="56" r="20" stroke="white" strokeWidth="9" fill="none" />
      <rect x="104" y="36" width="11" height="40" fill="white" />
      <rect x="95"  y="36" width="29" height="6"  fill="white" />
      <rect x="95"  y="70" width="29" height="6"  fill="white" />
      <path d="M 76 16 L 56 54 L 70 54 L 60 88 L 92 48 L 76 48 L 92 16 Z" fill="#CCFF00" />
    </svg>
  );
}

export default function BrandMark({
  size = "md",
  showWordmark = true,
  showTagline = true,
  className = "",
}: BrandMarkProps) {
  const logoClass = {
    sm: "h-7 w-auto",
    md: "h-10 w-auto sm:h-12",
    lg: "h-12 w-auto sm:h-16",
  }[size];

  const wordClass = {
    sm: "text-lg",
    md: "text-2xl sm:text-3xl",
    lg: "text-3xl sm:text-4xl",
  }[size];

  return (
    <div className={`flex items-center gap-3 sm:gap-4 ${className}`}>
      <OILogo className={logoClass} />
      {showWordmark && (
        <div className="flex flex-col">
          <span className={`font-black leading-none tracking-tight text-white ${wordClass}`}>Onyx Intel</span>
          {showTagline && (
            <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.22em] text-white/40">
              A Onyx &amp; Iron Company
            </span>
          )}
        </div>
      )}
    </div>
  );
}
