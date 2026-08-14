import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnyxIntelDashboard from "@/components/OnyxIntelDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return <OnyxIntelDashboard />;
}
