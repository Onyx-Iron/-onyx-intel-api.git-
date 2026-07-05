import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "../data/website/knowledge-base.json");

function getKB() {
  try { return JSON.parse(fs.readFileSync(KB_PATH, "utf8")).knowledge_base; }
  catch { return null; }
}

// ── Tool definitions (OpenAI-compatible function calling format) ──────────────
export const CHATBOT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_service_info",
      description: "Retrieve details about a specific Onyx & Iron service",
      parameters: {
        type: "object",
        properties: {
          service_type: {
            type: "string",
            enum: ["concrete", "residential", "commercial", "civil", "pools", "developer"]
          }
        },
        required: ["service_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_service_area",
      description: "Verify if a location is within Onyx & Iron's service area",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          state: { type: "string", default: "TX" }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_contact_cta",
      description: "Generate a contact call-to-action with phone, email, and form link",
      parameters: {
        type: "object",
        properties: {
          context: { type: "string", description: "The service or topic the user asked about" }
        },
        required: ["context"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "qualify_lead",
      description: "Qualify an inbound lead based on project type, budget, timeline, and location",
      parameters: {
        type: "object",
        properties: {
          project_type: { type: "string" },
          estimated_budget: { type: "string" },
          timeline: { type: "string" },
          location: { type: "string" }
        },
        required: ["project_type", "location"]
      }
    }
  }
];

// ── Tool implementations ──────────────────────────────────────────────────────

export function get_service_info({ service_type }) {
  const kb = getKB();
  const svc = kb?.services?.[service_type];
  if (!svc) return { error: `Unknown service type: ${service_type}` };

  const facts = kb.company_facts;
  return {
    service: svc.label,
    url: `https://www.onyx-iron.com${svc.url}`,
    scope: svc.items,
    timeline: svc.timeline || null,
    differentiator: svc.differentiator || null,
    warranty: facts.warranty,
    insurance: facts.insurance,
    certifications: facts.certifications,
    quality_control: facts.quality_control,
    lead_time: facts.lead_time,
    contact_phone: facts.phone,
    contact_email: facts.email,
    contact_form: facts.contact_form
  };
}

export function check_service_area({ city, state = "TX" }) {
  const kb = getKB();
  const areas = kb?.service_areas;
  if (!areas) return { error: "Service area data unavailable" };

  const normalize = (s) => s.toLowerCase().trim();
  const cityNorm = normalize(city);

  const inPrimary = areas.primary.some(c => normalize(c) === cityNorm);
  const inExtended = areas.extended.some(c => normalize(c) === cityNorm);

  // Fuzzy county check — if user types "Collin County" or just "Collin"
  const inCounty = areas.extended.some(c =>
    normalize(c).includes(cityNorm) || cityNorm.includes(normalize(c).replace(" county",""))
  );

  // State check — we serve TX and neighboring areas (LA, AR for Shreveport/Texarkana)
  const servedStates = ["tx", "la", "ar"];
  const stateServed = servedStates.includes(normalize(state));

  if (inPrimary) {
    return {
      served: true,
      tier: "primary",
      message: `Yes — ${city} is in our primary service area. We're actively working projects there now.`,
      cta_phone: kb.company_facts.phone,
      cta_form: kb.company_facts.contact_form
    };
  }

  if (inExtended || inCounty) {
    return {
      served: true,
      tier: "extended",
      message: `Yes — ${city} is within our extended service area across North & East Texas. Call us to discuss your project.`,
      cta_phone: kb.company_facts.phone,
      cta_form: kb.company_facts.contact_form
    };
  }

  if (!stateServed) {
    return {
      served: false,
      tier: "out_of_range",
      message: `We currently focus on North & East Texas. ${city}, ${state} may be outside our typical range — call us at ${kb.company_facts.phone} and we'll let you know if we can help.`,
      cta_phone: kb.company_facts.phone
    };
  }

  // Unknown TX city — likely still servable
  return {
    served: "likely",
    tier: "unknown",
    message: `${city}, TX may be within our North & East Texas coverage. Call (945) 365-1245 or fill out our contact form and we'll confirm within one business day.`,
    cta_phone: kb.company_facts.phone,
    cta_form: kb.company_facts.contact_form
  };
}

export function generate_contact_cta({ context }) {
  const kb = getKB();
  const facts = kb?.company_facts;

  const contextLine = context
    ? `Ready to move forward on your ${context} project?`
    : "Ready to get started?";

  return {
    headline: contextLine,
    subtext: "No lead time — we start immediately after contract. Transparent, itemized pricing with no surprises.",
    options: [
      {
        type: "phone",
        label: "Call Now",
        value: facts?.phone || "(945) 365-1245",
        href: `tel:+19453651245`
      },
      {
        type: "email",
        label: "Email Us",
        value: facts?.email || "info@onyx-iron.com",
        href: `mailto:${facts?.email || "info@onyx-iron.com"}`
      },
      {
        type: "form",
        label: "Request a Free Estimate",
        value: facts?.contact_form || "https://www.onyx-iron.com/contact",
        href: facts?.contact_form || "https://www.onyx-iron.com/contact"
      }
    ],
    trust_signals: [
      `${facts?.years_in_business || "17+"}  years in DFW construction`,
      facts?.warranty || "2-year comprehensive warranty",
      facts?.insurance || "Fully insured and bonded",
      `${facts?.on_time_rate || "~90%"} on-time completion rate`
    ]
  };
}

export function qualify_lead({ project_type, estimated_budget, timeline, location }) {
  const kb = getKB();
  const facts = kb?.company_facts;

  // Map project type to service
  const typeMap = {
    concrete: ["concrete", "driveway", "foundation", "slab", "flatwork", "parking", "retaining"],
    residential: ["home", "house", "custom", "residential", "addition", "renovation", "remodel"],
    commercial: ["commercial", "office", "retail", "tenant", "finish-out", "fitout", "industrial"],
    civil: ["civil", "excavation", "grading", "site", "road", "drainage", "utility", "utilities"],
    pools: ["pool", "swimming", "water feature", "spa"],
    developer: ["developer", "development", "land", "horizontal", "subdivision", "owner rep"]
  };

  const typeLower = (project_type || "").toLowerCase();
  let matchedService = null;
  for (const [key, keywords] of Object.entries(typeMap)) {
    if (keywords.some(k => typeLower.includes(k))) { matchedService = key; break; }
  }

  // Budget qualification
  let budgetTier = "unknown";
  let budgetQualified = true;
  if (estimated_budget) {
    const num = parseInt(estimated_budget.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(num)) {
      if (num < 5000) { budgetTier = "below_minimum"; budgetQualified = false; }
      else if (num < 50000) budgetTier = "small";
      else if (num < 500000) budgetTier = "mid";
      else if (num < 5000000) budgetTier = "large";
      else budgetTier = "enterprise";
    }
  }

  // Location check
  const areaCheck = check_service_area({ city: location || "", state: "TX" });
  const locationQualified = areaCheck.served === true || areaCheck.served === "likely";

  // Overall qualification
  const qualified = budgetQualified && locationQualified;

  const svcInfo = matchedService ? kb?.services?.[matchedService] : null;

  return {
    qualified,
    score: qualified ? (budgetTier === "enterprise" || budgetTier === "large" ? "high" : "medium") : "low",
    project_type: matchedService || "general",
    service_label: svcInfo?.label || project_type,
    service_url: svcInfo ? `https://www.onyx-iron.com${svcInfo.url}` : facts?.contact_form,
    budget_tier: budgetTier,
    budget_qualified: budgetQualified,
    location_status: areaCheck,
    timeline: timeline || "Not specified",
    recommended_action: qualified
      ? `Connect with Onyx & Iron for a ${svcInfo?.label || project_type} consultation. Call ${facts?.phone} or visit ${facts?.contact_form}.`
      : budgetQualified === false
        ? `Project budget appears below our typical minimum ($5,000). Call ${facts?.phone} to discuss — we may still be able to help.`
        : `Location may be outside our primary service area. Call ${facts?.phone} to confirm coverage.`,
    next_steps: qualified ? [
      `Call ${facts?.phone} for a same-day consultation`,
      "Request a free, itemized estimate — no obligation",
      `Timeline note: ${svcInfo?.timeline || "Contact us to discuss your schedule"}`
    ] : [],
    trust_signals: [
      `${facts?.years_in_business} years in North Texas construction`,
      facts?.warranty,
      facts?.insurance,
      `Value engineering saves clients ${facts?.value_engineering_savings}`
    ]
  };
}

// ── Tool dispatcher — call by name from agent tool_calls ─────────────────────
export function executeChatbotTool(name, args) {
  switch (name) {
    case "get_service_info":     return get_service_info(args);
    case "check_service_area":   return check_service_area(args);
    case "generate_contact_cta": return generate_contact_cta(args);
    case "qualify_lead":         return qualify_lead(args);
    default: return { error: `Unknown tool: ${name}` };
  }
}
