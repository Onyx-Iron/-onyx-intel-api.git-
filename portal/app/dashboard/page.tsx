import { auth, currentUser } from "@clerk/nextjs/server";
import OnyxIntelDashboard from "@/components/OnyxIntelDashboard";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  const firstName = user?.firstName ?? undefined;

  return <OnyxIntelDashboard userName={firstName} />;
}
