import PublicBidForm from "@/components/procurement/PublicBidForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

// Deliberately no Clerk auth() check anywhere in this route — this page and
// its data (/api/public/procurement-request/[id]) and submit endpoint
// (/api/procurement/bids) are the intentionally public vendor-facing surface
// of the procurement flow. See those routes for the capability-link trust
// model (the uuid in the URL grants access to that one request only).
export default async function PublicBidPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-[#06070A] text-white flex items-center justify-center p-4">
      <PublicBidForm requestId={id} />
    </div>
  );
}
