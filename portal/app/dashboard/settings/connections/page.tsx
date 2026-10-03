import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PageHero from "@/components/layout/PageHero";
import ConnectionsPanel from "@/components/settings/ConnectionsPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ConnectionsSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <PageHero
        title="Connections"
        description="Link Google, Dropbox, ShareFile, Meta, Search Console, and Business Profile. iCloud uses Upload or Email import."
      />
      <p className="text-sm text-white/40">
        These connections power plan import, the bid board, organic presence, and SEO tools.{" "}
        <Link href="/dashboard/settings/team" className="text-[#CCFF00]/80 hover:underline">
          Team settings
        </Link>
      </p>
      <ConnectionsPanel />
    </div>
  );
}
