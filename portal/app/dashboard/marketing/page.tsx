import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import MarketingCommandCenter from "@/components/marketing/MarketingCommandCenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <MarketingCommandCenter />;
}
