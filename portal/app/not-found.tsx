import Link from "next/link";
import { OILogo } from "@/components/brand/BrandMark";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full bg-[#06070A] text-white">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
        <OILogo className="mx-auto h-16 w-auto" alt="Onyx Intel" />
        <p className="mt-6 text-[12px] font-bold uppercase tracking-[0.32em] text-[#CCFF00]">
          OnyxIntel
        </p>
        <h1 className="mt-6 text-[120px] font-black leading-none tracking-tight text-white sm:text-[160px]">
          404
        </h1>
        <p className="mt-4 max-w-md text-base text-white/60">
          This page doesn&apos;t exist — let&apos;s get you back on track.
        </p>
        <Link
          href="/dashboard"
          className="mt-10 inline-flex h-10 items-center justify-center rounded-full bg-[#CCFF00] px-6 text-xs font-bold uppercase tracking-widest text-black transition-opacity hover:opacity-85"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
