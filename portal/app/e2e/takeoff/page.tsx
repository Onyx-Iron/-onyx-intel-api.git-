import { notFound } from "next/navigation";
import TakeoffTab from "@/components/takeoff/TakeoffTab";

export default function TakeoffAcceptanceHarness() {
  if (process.env.PLAYWRIGHT_TEST_MODE !== "1") notFound();
  return <main className="min-h-screen bg-[#08090B] p-8 text-white"><TakeoffTab projectId="00000000-0000-4000-8000-000000000001" /></main>;
}
