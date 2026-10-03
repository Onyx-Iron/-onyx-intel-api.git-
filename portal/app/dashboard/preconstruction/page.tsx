import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import PageHero from "@/components/layout/PageHero";
import BidBoard from "@/components/preconstruction/BidBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PreconstructionPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="space-y-6 px-4 py-8 lg:px-10">
      <PageHero
        eyebrow="Preconstruction"
        title="Bid Board"
        description="Track ITBs from email and market feeds through takeoff, pricing, and award — linked to projects, documents, and estimates."
      />
      <BidBoard />
    </div>
  );
}
