import Link from "next/link";

export default function LegalPage({ title, effectiveDate, children }: {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#06070A] px-6 py-12 text-white">
      <article className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl sm:p-10">
        <Link href="/dashboard" className="text-sm font-semibold text-[#CCFF00]">OnyxIntel</Link>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-white/45">Effective {effectiveDate}</p>
        <div className="mt-8 space-y-7 text-sm leading-7 text-white/70 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
        <nav className="mt-10 flex gap-5 border-t border-white/10 pt-6 text-sm text-white/55">
          <Link href="/terms" className="hover:text-white">Terms</Link>
          <Link href="/privacy" className="hover:text-white">Privacy</Link>
          <Link href="/sign-in" className="hover:text-white">Sign in</Link>
        </nav>
      </article>
    </main>
  );
}
