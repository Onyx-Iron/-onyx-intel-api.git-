import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import MobileTopBar from "@/components/layout/MobileTopBar";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import AppProviders from "@/components/common/AppProviders";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <AppProviders>
      <div className="min-h-screen bg-[#06070A]">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-[#CCFF00] focus:text-black focus:px-4 focus:py-2 focus:rounded">Skip to main content</a>
        <Sidebar />
        <MobileTopBar />
        <OnboardingTour />
        <main id="main-content" className="min-h-screen lg:pl-60">
          {children}
        </main>
      </div>
    </AppProviders>
  );
}
