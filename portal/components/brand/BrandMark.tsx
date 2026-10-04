import React from "react";
import logoSrc from "./oi-logo.png";

interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
}

const src = typeof logoSrc === "string" ? logoSrc : logoSrc.src;

export function OILogo({
  className = "h-12 w-auto",
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    // Brand raster — height is set by className (h-7 / h-12), width follows.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={546}
      height={415}
      className={className}
      draggable={false}
      aria-hidden={alt === "" ? true : undefined}
    />
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
