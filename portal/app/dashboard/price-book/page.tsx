import { auth } from "@clerk/nextjs/server";
import PriceBookManager from "@/components/pricebook/PriceBookManager";

export default async function PriceBookPage() {
  const { userId } = await auth();
  if (!userId) return null;
  return <PriceBookManager />;
}
