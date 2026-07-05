export type PlanTier =
  | "trial"
  | "solo"
  | "crew"
  | "business"
  | "enterprise"
  | "comp";

export interface PlanDef {
  tier: PlanTier;
  label: string;
  monthlyPriceUSD: number | "contact";
  paddlePriceIdMonthly: string | null;
  paddlePriceIdYearly: string | null;
  seatLimit: number; // -1 = unlimited
  projectLimit: number; // -1 = unlimited
  aiCreditsPerMonth: number; // -1 = unlimited
  features: string[];
}

// Order matters: index = relative power. Comp is highest; trial is lowest.
const TIER_ORDER: PlanTier[] = [
  "trial",
  "solo",
  "crew",
  "business",
  "enterprise",
  "comp",
];

export function tierRank(t: PlanTier): number {
  const i = TIER_ORDER.indexOf(t);
  return i === -1 ? -1 : i;
}

export function tierIsAtLeast(actual: PlanTier, required: PlanTier): boolean {
  return tierRank(actual) >= tierRank(required);
}

// Number of days a new tenant gets free trial access on signup
export const TRIAL_DAYS = 3;

export const PLANS: PlanDef[] = [
  {
    tier: "trial",
    label: "Free Trial",
    monthlyPriceUSD: 0,
    paddlePriceIdMonthly: null,
    paddlePriceIdYearly: null,
    seatLimit: 1,
    projectLimit: 3,
    aiCreditsPerMonth: 10,
    features: [
      "3-day free trial",
      "1 seat",
      "3 projects",
      "10 AI generations",
      "Everything else unlocked",
    ],
  },
  {
    tier: "solo",
    label: "Solo",
    monthlyPriceUSD: 99,
    paddlePriceIdMonthly: process.env.PADDLE_PRICE_SOLO_MONTHLY ?? null,
    paddlePriceIdYearly: process.env.PADDLE_PRICE_SOLO_YEARLY ?? null,
    seatLimit: 1,
    projectLimit: 5,
    aiCreditsPerMonth: 100,
    features: [
      "1 seat",
      "5 projects",
      "100 AI generations / month",
      "Drive autosave",
    ],
  },
  {
    tier: "crew",
    label: "Crew",
    monthlyPriceUSD: 250,
    paddlePriceIdMonthly: process.env.PADDLE_PRICE_CREW_MONTHLY ?? null,
    paddlePriceIdYearly: process.env.PADDLE_PRICE_CREW_YEARLY ?? null,
    seatLimit: 5,
    projectLimit: -1,
    aiCreditsPerMonth: 500,
    features: [
      "5 seats",
      "Unlimited projects",
      "500 AI generations / month",
      "Takeoff streaming",
      "Drive autosave",
    ],
  },
  {
    tier: "business",
    label: "Business",
    monthlyPriceUSD: 499,
    paddlePriceIdMonthly: process.env.PADDLE_PRICE_BUSINESS_MONTHLY ?? null,
    paddlePriceIdYearly: process.env.PADDLE_PRICE_BUSINESS_YEARLY ?? null,
    seatLimit: 15,
    projectLimit: -1,
    aiCreditsPerMonth: 2000,
    features: [
      "15 seats",
      "Unlimited projects",
      "2000 AI generations / month",
      "Priority support",
      "Custom RFI templates",
      "Takeoff streaming",
      "Drive autosave",
    ],
  },
  {
    tier: "enterprise",
    label: "Enterprise",
    monthlyPriceUSD: "contact",
    paddlePriceIdMonthly: null,
    paddlePriceIdYearly: null,
    seatLimit: -1,
    projectLimit: -1,
    aiCreditsPerMonth: -1,
    features: [
      "SSO",
      "Dedicated CSM",
      "Custom contract",
      "NET-30 terms",
      "On-prem option",
      "Unlimited seats / projects / AI",
    ],
  },
  {
    tier: "comp",
    label: "Complimentary",
    monthlyPriceUSD: 0,
    paddlePriceIdMonthly: null,
    paddlePriceIdYearly: null,
    seatLimit: -1,
    projectLimit: -1,
    aiCreditsPerMonth: -1,
    features: ["Bypasses all plan limits"],
  },
];

export function getPlan(tier: PlanTier): PlanDef {
  const plan = PLANS.find((p) => p.tier === tier);
  if (!plan) {
    // Fallback to trial if tier string is unknown
    return PLANS[0];
  }
  return plan;
}
