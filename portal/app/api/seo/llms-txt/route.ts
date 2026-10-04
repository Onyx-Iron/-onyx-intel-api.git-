import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getOrCreateTenant, authTenantKey, authTenantName } from "@/lib/project-controls/server";
import { buildLlmsTxt, buildOrganizationJsonLd } from "@/lib/seo/llmsTxt";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId, orgSlug } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = await getOrCreateTenant(authTenantKey(userId, orgId), authTenantName(userId, orgSlug));
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: presence } = await (db as any)
    .from("tenant_presence")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const companyName = authTenantName(userId, orgSlug) || "Company";
  const serviceAreas = Array.isArray(presence?.service_areas)
    ? presence.service_areas.filter((x: unknown) => typeof x === "string")
    : [];

  const llmsTxt = buildLlmsTxt({
    companyName,
    websiteUrl: presence?.website_url,
    blurb: presence?.llms_txt_blurb,
    serviceAreas,
  });
  const jsonLd = Object.keys(presence?.organization_jsonld ?? {}).length
    ? presence.organization_jsonld
    : buildOrganizationJsonLd({
      name: companyName,
      url: presence?.website_url,
      serviceAreas,
    });

  return NextResponse.json({ llms_txt: llmsTxt, json_ld: jsonLd, presence: presence ?? null });
}
