import { notFound } from "next/navigation";
import PriceBookManager from "@/components/pricebook/PriceBookManager";

export default function PriceBookE2EPage() {
  if (process.env.PLAYWRIGHT_TEST_MODE !== "1") notFound();
  return <main className="min-h-screen bg-[#08090B] text-white"><PriceBookManager /></main>;
}
