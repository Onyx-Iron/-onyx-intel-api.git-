export interface LlmsTxtInput {
  companyName: string;
  websiteUrl?: string | null;
  blurb?: string | null;
  serviceAreas?: string[];
  services?: string[];
}

/** Free LLMO artifact — plain markdown for crawlers / answer engines. */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const areas = (input.serviceAreas ?? []).filter(Boolean);
  const services = (input.services ?? [
    "construction estimating",
    "plan takeoff",
    "civil earthwork",
    "project controls",
  ]);
  const lines = [
    `# ${input.companyName}`,
    "",
    input.blurb?.trim() || `${input.companyName} is a construction intelligence company.`,
    "",
    "## Website",
    input.websiteUrl || "(not set)",
    "",
    "## Services",
    ...services.map((s) => `- ${s}`),
    "",
    "## Service areas",
    ...(areas.length ? areas.map((a) => `- ${a}`) : ["- (not set)"]),
    "",
    "## Contact",
    "See the company website for current contact details.",
    "",
  ];
  return lines.join("\n");
}

export function buildOrganizationJsonLd(input: {
  name: string;
  url?: string | null;
  serviceAreas?: string[];
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: input.url || undefined,
    areaServed: (input.serviceAreas ?? []).map((a) => ({ "@type": "Place", name: a })),
  };
}
